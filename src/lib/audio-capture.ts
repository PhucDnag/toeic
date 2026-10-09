// ===== Universal PCM WAV Audio Capture Service =====
// Captures mic or tab audio, computes real-time level, downsamples to 16kHz,
// encodes valid WAV blobs, and sends to /api/transcribe (Groq Whisper AI).

export type TranscriptCallback = (text: string) => void;
export type LevelCallback = (level: number) => void;
export type ErrorCallback = (error: string) => void;

const TARGET_SAMPLE_RATE = 16000;
// Flush on a short pause instead of making every sentence wait ten seconds.
// Continuous speech still gets bounded windows with context across boundaries.
const CHUNK_SAMPLES = TARGET_SAMPLE_RATE * 4;
const OVERLAP_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.8);
const PAUSE_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.35);
const MIN_FINAL_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.05);
const MIN_PAUSE_CHUNK_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 1.2);
const AUDIBLE_RMS = 0.00015;

interface AudioChunk {
  samples: Float32Array;
  sessionId: number;
}

export function hasAudibleAudio(samples: Float32Array): boolean {
  let energy = 0;
  let activeSamples = 0;
  for (let index = 0; index < samples.length; index++) {
    const amplitude = Math.abs(samples[index]);
    energy += amplitude * amplitude;
    if (amplitude >= AUDIBLE_RMS) activeSamples++;
  }

  const rms = Math.sqrt(energy / Math.max(1, samples.length));
  const activeRatio = activeSamples / Math.max(1, samples.length);
  return rms >= AUDIBLE_RMS && activeRatio >= 0.01;
}

export function normalizeAudio(samples: Float32Array): Float32Array {
  let energy = 0;
  let peak = 0;
  for (const sample of samples) {
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(energy / Math.max(1, samples.length));
  if (!peak || rms < AUDIBLE_RMS) return samples;
  const gain = Math.min(16, 0.06 / rms, 0.95 / peak);
  return samples.map(sample => sample * gain);
}

function encodeWav(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function downsample(input: Float32Array, fromRate: number, toRate = 16000): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const newLength = Math.round(input.length / ratio);
  const output = new Float32Array(newLength);
  let offsetOutput = 0;
  let offsetInput = 0;

  while (offsetOutput < output.length) {
    const nextOffsetInput = Math.round((offsetOutput + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetInput; i < nextOffsetInput && i < input.length; i++) {
      accum += input[i];
      count++;
    }
    output[offsetOutput] = count > 0 ? accum / count : 0;
    offsetOutput++;
    offsetInput = nextOffsetInput;
  }
  return output;
}

function normalizeWord(word: string): string {
  return word.toLocaleLowerCase('en-US').replace(/[^a-z0-9']/g, '');
}

/**
 * Chunks overlap so Whisper can hear complete words at their boundaries. Return
 * only the portion that was not already committed by the previous chunks.
 */
export function removeTranscriptOverlap(previous: string, current: string): string {
  const currentWords = current.trim().split(/\s+/).filter(Boolean);
  if (currentWords.length === 0) return '';

  const previousWords = previous.trim().split(/\s+/).filter(Boolean);
  const maxOverlap = Math.min(20, previousWords.length, currentWords.length);

  // A one-word match is too easy to hit by coincidence (for example "the" at
  // both sides of a boundary), so prefer a harmless duplicate over losing it.
  for (let size = maxOverlap; size >= 2; size--) {
    let matches = true;
    for (let index = 0; index < size; index++) {
      const previousWord = normalizeWord(previousWords[previousWords.length - size + index]);
      const currentWord = normalizeWord(currentWords[index]);
      if (!previousWord || previousWord !== currentWord) {
        matches = false;
        break;
      }
    }

    if (matches) return currentWords.slice(size).join(' ');
  }

  return currentWords.join(' ');
}

export class AudioCaptureService {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private flushWorklet: (() => void) | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private isCapturing = false;

  private onTranscript: TranscriptCallback | null = null;
  private onLevel: LevelCallback | null = null;
  private onError: ErrorCallback | null = null;

  // Audio sample buffer (16kHz)
  private sampleBuffer: number[] = [];
  private pendingChunks: AudioChunk[] = [];
  private queueDrainPromise: Promise<void> | null = null;
  private hasQueuedChunk = false;
  private retainedSamples = 0;
  private trailingSilenceSamples = 0;
  private freshSpeech = false;
  private sessionId = 0;
  private activeRequest: AbortController | null = null;
  private committedTranscript = '';

  setCallbacks(
    onTranscript: TranscriptCallback,
    onLevel: LevelCallback,
    onError: ErrorCallback
  ) {
    this.onTranscript = onTranscript;
    this.onLevel = onLevel;
    this.onError = onError;
  }

  async startMicrophone(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      return this.startWithStream(stream);
    } catch (err) {
      console.error('Microphone access failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Permission denied') || msg.includes('NotAllowedError')) {
        this.onError?.('Quyền truy cập Microphone bị từ chối trong trình duyệt. Vui lòng cho phép quyền mic.');
      } else {
        this.onError?.(`Không thể mở microphone: ${msg}`);
      }
      return false;
    }
  }

  async startDisplayMedia(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        this.onError?.('Bạn chưa tích chọn "Chia sẻ âm thanh hệ thống" (Share tab audio). Vui lòng thử lại.');
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }

      return this.startWithStream(stream);
    } catch (err) {
      console.warn('DisplayMedia cancelled:', err);
      return false;
    }
  }

  private async startWithStream(stream: MediaStream): Promise<boolean> {
    // A new source must never receive a late transcript from the previous one.
    await this.stop(false);
    const captureSession = this.sessionId;
    this.stream = stream;

    try {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioContextClass();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const sampleRate = this.audioContext.sampleRate;
      this.source = this.audioContext.createMediaStreamSource(stream);
      const highPass = this.audioContext.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 70;
      this.source.connect(highPass);

      this.sampleBuffer = [];
      this.pendingChunks = [];
      this.hasQueuedChunk = false;
      this.retainedSamples = 0;
      this.trailingSilenceSamples = 0;
      this.freshSpeech = false;
      this.committedTranscript = '';
      this.isCapturing = true;

      const receiveSamples = (inputData: Float32Array) => {
        if (!this.isCapturing) return;

        // Compute RMS audio level
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        const normalizedLevel = Math.min(1, rms * 5); // Boost scale for visual responsiveness
        this.onLevel?.(normalizedLevel);

        // Downsample to 16kHz
        const downsampled = downsample(inputData, sampleRate, TARGET_SAMPLE_RATE);
        for (let i = 0; i < downsampled.length; i++) {
          this.sampleBuffer.push(downsampled[i]);
        }

        if (rms >= AUDIBLE_RMS) {
          this.freshSpeech = true;
          this.trailingSilenceSamples = 0;
        } else {
          this.trailingSilenceSamples += downsampled.length;
        }
        this.queueReadyChunks();
      };

      try {
        await this.audioContext.audioWorklet.addModule('/audio-capture-worklet.js');
        if (captureSession !== this.sessionId) return false;
        this.worklet = new AudioWorkletNode(this.audioContext, 'toeic-capture');
        this.worklet.port.onmessage = ({ data }) => {
          if (data === 'flushed') this.flushWorklet?.();
          else if (data instanceof Float32Array) receiveSamples(data);
        };
        this.worklet.onprocessorerror = () => this.onError?.('Bộ thu âm bị gián đoạn. Hãy dừng và bật microphone lại.');
        highPass.connect(this.worklet);
        this.worklet.connect(this.audioContext.destination);
      } catch {
        if (captureSession !== this.sessionId) return false;
        // Compatibility path for browsers that cannot load AudioWorklet.
        this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
        this.processor.onaudioprocess = e => receiveSamples(e.inputBuffer.getChannelData(0));
        highPass.connect(this.processor);
        this.processor.connect(this.audioContext.destination);
      }

      stream.getAudioTracks().forEach(track => {
        track.onended = () => this.onError?.('Nguồn âm thanh đã ngắt. Hãy kết nối lại microphone hoặc âm thanh tab.');
      });

      return true;
    } catch (err) {
      if (captureSession !== this.sessionId) return false;
      console.error('AudioContext init error:', err);
      await this.stop(false);
      this.onError?.('Không thể khởi tạo Web Audio API.');
      return false;
    }
  }

  private queueReadyChunks() {
    const stepSamples = CHUNK_SAMPLES - OVERLAP_SAMPLES;

    while (this.sampleBuffer.length >= CHUNK_SAMPLES) {
      this.pendingChunks.push({
        samples: new Float32Array(this.sampleBuffer.slice(0, CHUNK_SAMPLES)),
        sessionId: this.sessionId,
      });
      this.sampleBuffer = this.sampleBuffer.slice(stepSamples);
      this.hasQueuedChunk = true;
      this.retainedSamples = OVERLAP_SAMPLES;
      this.freshSpeech = false;
    }

    if (this.freshSpeech && this.trailingSilenceSamples >= PAUSE_SAMPLES &&
        this.sampleBuffer.length - this.retainedSamples >= MIN_PAUSE_CHUNK_SAMPLES) {
      this.pendingChunks.push({
        samples: new Float32Array(this.sampleBuffer),
        sessionId: this.sessionId,
      });
      this.sampleBuffer = this.sampleBuffer.slice(-OVERLAP_SAMPLES);
      this.retainedSamples = this.sampleBuffer.length;
      this.hasQueuedChunk = true;
      this.freshSpeech = false;
    }

    void this.processQueue();
  }

  private queueFinalChunk(): Promise<void> {
    const uniqueSampleCount = this.hasQueuedChunk
      ? Math.max(0, this.sampleBuffer.length - this.retainedSamples)
      : this.sampleBuffer.length;

    // Do not resend a chunk containing only the retained overlap. A short real
    // tail is still sent together with that overlap so the final word survives.
    if (uniqueSampleCount >= MIN_FINAL_SAMPLES) {
      this.pendingChunks.push({
        samples: new Float32Array(this.sampleBuffer),
        sessionId: this.sessionId,
      });
    }
    this.sampleBuffer = [];
    return this.processQueue();
  }

  private processQueue(): Promise<void> {
    if (this.queueDrainPromise) return this.queueDrainPromise;

    // Set the promise before draining, including when every chunk is silence.
    const drainPromise = Promise.resolve().then(() => this.drainQueue());
    this.queueDrainPromise = drainPromise;
    return drainPromise.finally(() => {
      if (this.queueDrainPromise === drainPromise) this.queueDrainPromise = null;
    });
  }

  private async drainQueue() {
    try {
      while (this.pendingChunks.length > 0) {
        const chunk = this.pendingChunks.shift();
        if (!chunk || chunk.sessionId !== this.sessionId) continue;
        await this.transcribeChunk(chunk);
      }
    } catch (err) {
      console.warn('Could not drain transcription queue:', err);
    }
  }

  private async transcribeChunk(chunk: AudioChunk) {
    // Avoid asking Whisper to invent text from digital silence or a tiny click.
    if (!hasAudibleAudio(chunk.samples)) return;

    const wavBlob = encodeWav(normalizeAudio(chunk.samples), TARGET_SAMPLE_RATE);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (chunk.sessionId !== this.sessionId) return;
      const controller = new AbortController();
      this.activeRequest = controller;
      const timeout = setTimeout(() => controller.abort(), 20000);
      let retryable = true;
      try {
        const formData = new FormData();
        formData.append('file', wavBlob, 'audio.wav');
        formData.append('context', this.committedTranscript.slice(-400));

        const res = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });

        if (res.ok) {
          const data: { text?: string } = await res.json();
          const text = data.text?.trim();

          if (text && chunk.sessionId === this.sessionId && !/^\.+$/.test(text)) {
            const novelText = removeTranscriptOverlap(this.committedTranscript, text);
            if (novelText) {
              this.committedTranscript = `${this.committedTranscript} ${novelText}`.trim().slice(-2000);
              this.onTranscript?.(novelText);
            }
          }
          return;
        } else {
          retryable = res.status === 408 || res.status === 429 || res.status >= 500;
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        if (chunk.sessionId !== this.sessionId) return;
        if (!retryable || attempt === 2) {
          console.warn('Transcription failed after retries:', err);
          this.onError?.('Không nhận dạng được một đoạn âm thanh sau khi thử lại. Kiểm tra mạng/API và phát lại đoạn vừa nghe.');
          return;
        }
      } finally {
        clearTimeout(timeout);
        if (this.activeRequest === controller) this.activeRequest = null;
      }
      await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }

  async stop(flushPending = true): Promise<void> {
    const stoppingSession = this.sessionId;
    if (flushPending && this.worklet && this.isCapturing) {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 200);
        this.flushWorklet = () => { clearTimeout(timeout); resolve(); };
        this.worklet!.port.postMessage('flush');
      });
    }
    if (stoppingSession !== this.sessionId) return;
    this.isCapturing = false;
    this.flushWorklet = null;
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.onprocessorerror = null;
      this.worklet.disconnect();
      this.worklet.port.close();
      this.worklet = null;
    }

    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch { /* ignore */ }
      this.processor.onaudioprocess = null;
      this.processor = null;
    }

    if (this.source) {
      try {
        this.source.disconnect();
      } catch { /* ignore */ }
      this.source = null;
    }

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch { /* ignore */ }
      this.audioContext = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    let drainPromise: Promise<void>;
    if (flushPending) {
      drainPromise = this.queueFinalChunk();
    } else {
      this.sessionId++;
      this.sampleBuffer = [];
      this.pendingChunks = [];
      this.hasQueuedChunk = false;
      this.retainedSamples = 0;
      this.trailingSilenceSamples = 0;
      this.freshSpeech = false;
      this.committedTranscript = '';
      this.activeRequest?.abort();
      this.activeRequest = null;
      drainPromise = this.queueDrainPromise ?? Promise.resolve();
    }
    this.onLevel?.(0);
    return drainPromise;
  }

  getIsCapturing(): boolean {
    return this.isCapturing;
  }
}
