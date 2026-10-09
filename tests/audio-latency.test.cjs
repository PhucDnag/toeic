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
const { AudioCaptureService, hasAudibleAudio, normalizeAudio, removeTranscriptOverlap } = loaded.exports;

function fixture() {
  const service = new AudioCaptureService();
  // Hold the network worker so we can inspect the queued audio deterministically.
  service.processQueue = () => Promise.resolve();
  return service;
}

test('a short utterance flushes on pause without waiting for a full window', () => {
  const service = fixture();
  service.sampleBuffer = [...new Array(16000).fill(0.1), ...new Array(5600).fill(0)];
  service.freshSpeech = true;
  service.trailingSilenceSamples = 5600;
  service.queueReadyChunks();
  assert.equal(service.pendingChunks.length, 1);
  assert.equal(service.pendingChunks[0].samples.length, 21600);
  service.queueReadyChunks();
  assert.equal(service.pendingChunks.length, 1, 'same pause must not be resent');
});

test('a tiny pause after a number is not sent as an isolated fragment', () => {
  const service = fixture();
  service.sampleBuffer = [...new Array(3200).fill(0.1), ...new Array(5600).fill(0)];
  service.freshSpeech = true;
  service.trailingSilenceSamples = 5600;
  service.queueReadyChunks();
  assert.equal(service.pendingChunks.length, 0);
  service.sampleBuffer.push(...new Array(12000).fill(0.1), ...new Array(5600).fill(0));
  service.queueReadyChunks();
  assert.equal(service.pendingChunks.length, 1);
});

test('quiet speech is preserved and amplified without clipping; silence and clicks are rejected', () => {
  const quiet = Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i / 10) * 0.0008);
  assert.equal(hasAudibleAudio(quiet), true);
  const normalized = normalizeAudio(quiet);
  assert.ok(Math.max(...normalized) > 0.01);
  assert.ok(Math.max(...normalized) < 1);
  assert.equal(hasAudibleAudio(new Float32Array(16000)), false);
  const click = new Float32Array(16000); click[100] = 1;
  assert.equal(hasAudibleAudio(click), false);
});

test('failed chunk is retried before the following chunk and genuine Thank you is retained', async t => {
  const service = new AudioCaptureService();
  const transcripts = [];
  const contexts = [];
  let requests = 0;
  service.setCallbacks(text => transcripts.push(text), () => {}, error => assert.fail(error));
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    contexts.push(options.body.get('context'));
    requests++;
    if (requests === 1) return new Response('{}', { status: 503 });
    return Response.json({ text: requests === 2 ? 'Thank you.' : 'Number 32. Where are the speakers?' });
  });
  service.pendingChunks = [0, 1].map(() => ({ samples: new Float32Array(16000).fill(0.01), sessionId: 0 }));
  await service.processQueue();
  assert.equal(requests, 3);
  assert.deepEqual(transcripts, ['Thank you.', 'Number 32. Where are the speakers?']);
  assert.equal(contexts[2], 'Thank you.');
});

test('a permanent API failure is visible instead of silently losing audio', async t => {
  const service = new AudioCaptureService();
  const errors = [];
  service.setCallbacks(() => assert.fail('unexpected transcript'), () => {}, error => errors.push(error));
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 401 }));
  service.pendingChunks = [{ samples: new Float32Array(16000).fill(0.01), sessionId: 0 }];
  await service.processQueue();
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(errors.length, 1);
});

test('overlap removes only matching boundary text and keeps new words', () => {
  assert.equal(removeTranscriptOverlap('The meeting starts at nine', 'at nine tomorrow morning.'), 'tomorrow morning.');
  assert.equal(removeTranscriptOverlap('I said the', 'the manager is here.'), 'the manager is here.');
});

test('worklet buffers every sample in order and flushes the last partial block', () => {
  const vm = require('node:vm');
  const messages = [];
  let Processor;
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../public/audio-capture-worklet.js'), 'utf8'), {
    Float32Array,
    AudioWorkletProcessor: class { port = { postMessage: data => messages.push(data) }; },
    registerProcessor: (_name, processor) => { Processor = processor; },
  });
  const processor = new Processor();
  for (let offset = 0; offset < 2560; offset += 128) {
    processor.process([[Float32Array.from({ length: 128 }, (_, i) => offset + i)]]);
  }
  processor.port.onmessage({ data: 'flush' });
  assert.equal(messages.at(-1), 'flushed');
  assert.deepEqual(messages.slice(0, -1).flatMap(array => [...array]), Array.from({ length: 2560 }, (_, i) => i));
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
