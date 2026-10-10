// Optional live Groq smoke test: node tests/manual-audio-smoke.cjs <16kHz mono PCM WAV> [base URL]
// Requires the app server and configured Groq keys. Makes real API requests.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
function load(name) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib', name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('exports', 'module', compiled)(loaded.exports, loaded);
  return loaded.exports;
}
async function main() {
  const wav = fs.readFileSync(process.argv[2]);
  const base = process.argv[3] || 'http://localhost:3211';
  let pcm;
  for (let i = 12; i + 8 <= wav.length;) {
    const size = wav.readUInt32LE(i + 4);
    const kind = wav.toString('ascii', i, i + 4);
    if (kind === 'fmt ') {
      assert.equal(wav.readUInt16LE(i + 8), 1);
      assert.equal(wav.readUInt16LE(i + 10), 1);
      assert.equal(wav.readUInt32LE(i + 12), 16000);
      assert.equal(wav.readUInt16LE(i + 22), 16);
    }
    if (kind === 'data') pcm = wav.subarray(i + 8, i + 8 + size);
    i += 8 + size + (size % 2);
  }
  assert.ok(pcm);
  const { AudioCaptureService } = load('audio-capture.ts');
  const { RawListeningSession } = load('raw-listening.ts');
  const capture = new AudioCaptureService();
  const session = new RawListeningSession();
  const actualFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => actualFetch(new URL(url, base), options);
  const transcripts = [];
  let history = [];
  session.onStateChange((_state, context) => { history = context.history; if (context.lastError) console.log('SESSION:', context.lastError); });
  session.setSolveCallback(async (transcript, context, signal) => {
    const result = await fetch('/api/solve', { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'raw', transcript, context }) });
    assert.equal(result.status, 200);
    const parsed = await result.json();
    console.log('SOLVED:', JSON.stringify(parsed.answers));
    return parsed;
  });
  session.start();
  capture.setCallbacks(text => {
    transcripts.push(text);
    console.log('HEARD:', text);
    session.processTranscript(text);
  }, () => {}, error => { throw new Error(error); });
  try {
    // Feed the same RMS/pause logic in small blocks, drain each upload to test
    // the normal low-backlog path (the path previously replaying each answer).
    for (let offset = 0; offset < pcm.length; offset += 2048) {
      let energy = 0;
      const count = Math.min(1024, (pcm.length - offset) / 2);
      for (let i = 0; i < count; i++) {
        const sample = pcm.readInt16LE(offset + i * 2) / 32768;
        capture.sampleBuffer.push(sample);
        energy += sample * sample;
      }
      if (Math.sqrt(energy / count) >= 0.00015) {
        capture.freshSpeech = true;
        capture.trailingSilenceSamples = 0;
      } else capture.trailingSilenceSamples += count;
      capture.queueReadyChunks();
      if (capture.queueDrainPromise) await capture.queueDrainPromise;
    }
    await capture.stop();
    await session.flush();
    console.log(JSON.stringify({ transcript: transcripts.join(' '), history }, null, 2));
    assert.equal(history.length, 9, 'expected exactly nine answers');
    assert.deepEqual(history.map(item => item.questionNumber), [12, 13, 14, 15, 16, 17, 18, 19, 20]);
    for (let i = 0; i < history.length; i++) {
      const expected = [/Luis|Louis/i, /once a month/i, /show you/i][i % 3];
      assert.match(history[i].answerText, expected);
    }
    console.log('PASS: nine questions, no duplicate answers, correct indirect replies.');
  } finally { session.stop(); await capture.stop(false); globalThis.fetch = actualFetch; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
