const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const compiled = ts.transpileModule(
  fs.readFileSync(require('node:path').join(__dirname, '../src/lib/audio-capture.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
).outputText;
const loaded = { exports: {} };
new Function('exports', 'module', compiled)(loaded.exports, loaded);
const { AudioCaptureService } = loaded.exports;

function fixture() {
  const service = new AudioCaptureService();
  // Hold the network worker so we can inspect the queued audio deterministically.
  service.processQueue = () => Promise.resolve();
  return service;
}

test('a short utterance flushes on pause without waiting for a full window', () => {
  const service = fixture();
  service.sampleBuffer = [...new Array(8000).fill(0.1), ...new Array(5600).fill(0)];
  service.freshSpeech = true;
  service.trailingSilenceSamples = 5600;
  service.queueReadyChunks();
  assert.equal(service.pendingChunks.length, 1);
  assert.equal(service.pendingChunks[0].samples.length, 13600);
  service.queueReadyChunks();
  assert.equal(service.pendingChunks.length, 1, 'same pause must not be resent');
});

test('continuous speech is queued with overlap even when network is busy', () => {
  const service = fixture();
  service.sampleBuffer = Array.from({ length: 120000 }, (_, i) => i);
  service.queueReadyChunks();
  assert.equal(service.pendingChunks.length, 2);
  assert.equal(service.pendingChunks[0].samples.length, 64000);
  assert.equal(service.pendingChunks[1].samples[0], 51200);
  assert.equal(service.sampleBuffer[0], 102400);
});

test('stop preserves a short tail and does not resend overlap alone', async () => {
  const service = fixture();
  service.sampleBuffer = new Array(4000).fill(0.1);
  service.freshSpeech = true;
  service.trailingSilenceSamples = 5600;
  service.queueReadyChunks();
  await service.stop();
  assert.equal(service.pendingChunks.length, 1);
  const tail = fixture();
  tail.sampleBuffer = new Array(1000).fill(0.1);
  await tail.stop();
  assert.equal(tail.pendingChunks.length, 1);
});
