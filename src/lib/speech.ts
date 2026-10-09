// ===== Speech Recognition Service =====
// Wraps the Web Speech API for continuous speech-to-text

export type SpeechCallback = (text: string, isFinal: boolean) => void;
export type ErrorCallback = (error: string) => void;

export class SpeechService {
  private recognition: SpeechRecognition | null = null;
  private isRunning = false;
  private shouldRestart = false;
  private onResult: SpeechCallback | null = null;
  private onError: ErrorCallback | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInterim = '';

  constructor() {
    // Initial check
  }

  setCallbacks(onResult: SpeechCallback, onError: ErrorCallback) {
    this.onResult = onResult;
    this.onError = onError;
  }

  private cleanupCurrent() {
    if (this.recognition) {
      try {
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.abort();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
    this.isRunning = false;
  }

  private createAndStart() {
    if (!this.shouldRestart) return;

    this.cleanupCurrent();

    const SpeechRecognitionAPI =
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;

    if (!SpeechRecognitionAPI) {
      this.onError?.('Trình duyệt không hỗ trợ Web Speech API. Vui lòng dùng Google Chrome.');
      return;
    }

    try {
      const rec = new SpeechRecognitionAPI();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.maxAlternatives = 1;

      rec.onresult = (event: SpeechRecognitionEvent) => {
        let finalChunk = '';
        let interimChunk = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0].transcript;

          if (result.isFinal) {
            finalChunk += ' ' + transcript;
          } else {
            interimChunk += ' ' + transcript;
          }
        }

        if (finalChunk) {
          this.lastInterim = '';
          this.onResult?.(finalChunk.trim(), true);
        }
        if (interimChunk) {
          this.lastInterim = interimChunk.trim();
          this.onResult?.(interimChunk.trim(), false);
        }
      };

      rec.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.warn('Speech recognition notice:', event.error);

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.shouldRestart = false;
          this.onError?.('Quyền Microphone bị từ chối. Vui lòng cho phép quyền mic trong Chrome.');
          return;
        }

        // no-speech, aborted, audio-capture, network: let onend trigger the clean fresh restart
      };

      rec.onend = () => {
        this.isRunning = false;

        // If recognition closed while there was uncommitted interim speech, finalize it!
        if (this.lastInterim) {
          this.onResult?.(this.lastInterim, true);
          this.lastInterim = '';
        }

        if (this.shouldRestart) {
          if (this.restartTimer) clearTimeout(this.restartTimer);
          this.restartTimer = setTimeout(() => {
            if (this.shouldRestart) {
              this.createAndStart();
            }
          }, 80);
        }
      };

      rec.start();
      this.recognition = rec;
      this.isRunning = true;
    } catch (err) {
      console.warn('Could not start recognition, retrying:', err);
      if (this.shouldRestart) {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          if (this.shouldRestart) {
            this.createAndStart();
          }
        }, 300);
      }
    }
  }

  start() {
    this.shouldRestart = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.createAndStart();
  }

  stop() {
    this.shouldRestart = false;
    this.lastInterim = '';
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.cleanupCurrent();
  }

  isAvailable(): boolean {
    return (
      typeof window !== 'undefined' &&
      !!(window.SpeechRecognition || window.webkitSpeechRecognition)
    );
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }
}
