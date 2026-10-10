// Run explicitly to check the configured account with three small live requests.
// Never print credentials, request headers or raw SDK errors.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import nextEnv from '@next/env';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const loadPackage = createRequire(import.meta.url);
nextEnv.loadEnvConfig(path.resolve(scriptDirectory, '..'));
const cache = new Map();

export function loadSource(relativePath) {
  const filename = path.resolve(scriptDirectory, '../src', relativePath);
  if (cache.has(filename)) return cache.get(filename).exports;
  const loadedModule = { exports: {} };
  cache.set(filename, loadedModule);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const localRequire = name => {
    if (name === 'server-only') return {};
    if (name.startsWith('@/')) return loadSource(`${name.slice(2)}.ts`);
    if (name.startsWith('.')) return loadSource(path.resolve(path.dirname(filename), `${name}.ts`));
    return loadPackage(name);
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

async function main() {
  const { getGroqApiKeys } = loadSource('lib/server/groq-key-pool.ts');
  const key = getGroqApiKeys()[0];
  if (!key) throw new Error('No Groq key configured');
  const models = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000),
  });
  console.log('Model catalog HTTP:', models.status);
  if (!models.ok) throw new Error('Cannot query models');
  const catalog = await models.json();
  console.log('Active models:', catalog.data.filter(model => model.active !== false).map(model => model.id).join(', '));
  const { POST } = loadSource('app/api/solve/route.ts');
  const cases = [
    { question: 'Who ordered these vegetables?', choices: { A: 'All of it.', B: 'I believe Luis did.', C: 'It was excellent.' }, expected: 'B' },
    { question: 'When does the meeting start?', choices: { A: 'At nine o\'clock.', B: 'In room four.', C: 'The manager.' }, expected: 'A' },
    { question: 'Where is the conference being held?', choices: { A: 'Tomorrow morning.', B: 'About an hour.', C: 'At the downtown hotel.' }, expected: 'C' },
  ];
  for (const [index, fixture] of cases.entries()) {
    const start = Date.now();
    const response = await POST(new Request('http://localhost/api/solve', {
      method: 'POST', body: JSON.stringify({ part: 2, question_number: index + 7, ...fixture }),
    }));
    const result = await response.json();
    const ok = response.ok && result.answer === fixture.expected;
    console.log(`Q${index + 7}: HTTP ${response.status}, answer ${result.answer ?? '-'}, expected ${fixture.expected}, ${Date.now() - start} ms, ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch(error => {
  console.error('Live AI check failed:', error.name, error.status || error.cause?.code || '');
  process.exitCode = 1;
});
