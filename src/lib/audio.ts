// ===== Audio Service =====
// Handles microphone access and audio level metering

export type AudioLevelCallback = (level: number) => void;
export type MicStateCallback = (state: 'NOT_CONNECTED' | 'REQUESTING' | 'CONNECTED' | 'ERROR', error?: string) => void;

export class AudioService {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animationFrame: number | null = null;
  private onLevel: AudioLevelCallback | null = null;
  private onMicState: MicStateCallback | null = null;
  
  setCallbacks(onLevel: AudioLevelCallback, onMicState: MicStateCallback) {
    this.onLevel = onLevel;
    this.onMicState = onMicState;
  }
  
  async requestMicrophone(): Promise<boolean> {
    this.onMicState?.('REQUESTING');
    
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      
      // Set up audio analysis
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      
      const source = this.audioContext.createMediaStreamSource(this.stream);
      source.connect(this.analyser);
      
      this.onMicState?.('CONNECTED');
      this.startLevelMeter();
      
      return true;
    } catch (error) {
      console.error('Microphone error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
        this.onMicState?.('ERROR', 'Microphone permission denied');
      } else {
        this.onMicState?.('ERROR', `Microphone error: ${message}`);
      }
      
      return false;
    }
  }
  
  private startLevelMeter() {
    if (!this.analyser) return;
    
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    
    const updateLevel = () => {
      if (!this.analyser) return;
      
      this.analyser.getByteFrequencyData(dataArray);
      
      // Calculate RMS level
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const level = Math.min(rms / 128, 1); // Normalize to 0-1
      
      this.onLevel?.(level);
      
      this.animationFrame = requestAnimationFrame(updateLevel);
    };
    
    updateLevel();
  }
  
  getFrequencyData(): Uint8Array | null {
    if (!this.analyser) return null;
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }
  
  stop() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.analyser = null;
    this.onMicState?.('NOT_CONNECTED');
  }
  
  isConnected(): boolean {
    return this.stream !== null && this.stream.active;
  }
}
