/* global AudioWorkletProcessor, registerProcessor */
// Collect PCM on the audio rendering thread; never play the mic back to speakers.
class TOEICCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (data === 'flush') {
        this.flush();
        this.port.postMessage('flushed');
      }
    };
  }

  flush() {
    if (!this.offset) return;
    const samples = this.buffer.slice(0, this.offset);
    this.port.postMessage(samples, [samples.buffer]);
    this.offset = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i];
      this.buffer[this.offset++] = sample / channels.length;
      if (this.offset === this.buffer.length) this.flush();
    }
    return true;
  }
}

registerProcessor('toeic-capture', TOEICCaptureProcessor);
