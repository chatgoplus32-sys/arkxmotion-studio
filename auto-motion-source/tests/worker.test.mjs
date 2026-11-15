import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

const origin = 'https://auto-motion.test';
let ip = 0;
const env = { GEMINI_API_KEY: 'unit-test-placeholder' };
const request = (input = {}, headers = {}) => new Request(`${origin}/api/tts`, {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': `test-${++ip}`, ...headers },
  body: JSON.stringify({ text: 'Suara Auto Motion siap.', voice: 'Aoede', delivery: 'natural', ...input }),
});
const rawPcm = Buffer.alloc(4800);
for (let index = 0; index < 2400; index += 1) rawPcm.writeInt16LE(Math.sin(index / 10) * 6000, index * 2);
const audioResponse = (data, mime = 'audio/L16;codec=pcm;rate=24000') => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from(data).toString('base64'), mimeType: mime } }] } }],
}), { headers: { 'Content-Type': 'application/json' } });
const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; });

test('configuration check never calls Gemini and never exposes a secret', async () => {
  globalThis.fetch = () => { throw new Error('not permitted'); };
  const response = await worker.fetch(new Request(`${origin}/api/tts/status`), env);
  const body = await response.json();
  assert.deepEqual(body, { configured: true, maxChars: 2500 });
  assert.equal(JSON.stringify(body).includes(env.GEMINI_API_KEY), false);
});
test('origin and input validation block upstream transmission', async () => {
  globalThis.fetch = () => { throw new Error('not permitted'); };
  assert.equal((await worker.fetch(request({}, { Origin: 'https://other.test' }), env)).status, 403);
  assert.equal((await worker.fetch(request({ text: '' }), env)).status, 400);
  assert.equal((await worker.fetch(request({ text: 'x'.repeat(2501) }), env)).status, 413);
  assert.equal((await worker.fetch(request({ voice: 'unknown' }), env)).status, 400);
  assert.equal((await worker.fetch(request({ delivery: 'toString' }), env)).status, 400);
  assert.equal((await worker.fetch(request(), {})).status, 503);
});
test('only explicit POST sends the exact narration with separate delivery; PCM is made playable WAV', async () => {
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.match(url, /gemini-3\.8-flash-tts:generateContent$/);
    assert.equal(options.headers['x-goog-api-key'], env.GEMINI_API_KEY);
    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].parts[0].text, 'Suara Auto Motion siap.');
    assert.equal(body.contents[0].parts[0].speech_metadata.style, 'natural, clear, conversational');
    assert.equal(body.generationConfig.speechConfig.voiceConfig.voice, 'Aoede');
    assert.equal(body.generationConfig.responseFormat.audio.mimeType, 'AUDIO_WAV');
    return audioResponse(rawPcm);
  };
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/wav');
  assert.match(response.headers.get('cache-control'), /no-store/);
  const wav = Buffer.from(await response.arrayBuffer());
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.subarray(44).equals(rawPcm), true);
  assert.equal(calls, 1);
  globalThis._unitWav = wav;
});
test('complete WAV output is retained without a duplicate header', async () => {
  globalThis.fetch = async () => audioResponse(globalThis._unitWav, 'audio/wav');
  const response = await worker.fetch(request({ voice: 'Kore', delivery: 'professional' }), env);
  assert.equal(response.status, 200);
  assert.equal(Buffer.from(await response.arrayBuffer()).equals(globalThis._unitWav), true);
});
test('upstream failures are actionable and do not leak raw responses', async () => {
  for (const [status, code] of [[429, 'tts_quota'], [403, 'tts_permission_denied'], [404, 'tts_model_unavailable'], [400, 'tts_request_rejected'], [500, 'tts_unavailable']]) {
    globalThis.fetch = async () => new Response('sensitive upstream text', { status });
    const response = await worker.fetch(request(), env);
    assert.deepEqual(await response.json(), { error: code });
  }
});
test('malformed or empty audio is not mislabeled as a successful WAV', async () => {
  globalThis.fetch = async () => audioResponse(Buffer.from('not a wav'), 'audio/wav');
  assert.deepEqual(await (await worker.fetch(request(), env)).json(), { error: 'tts_format_invalid' });
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [] }));
  assert.deepEqual(await (await worker.fetch(request(), env)).json(), { error: 'tts_empty' });
});
test('API misses return JSON; non-API requests retain static asset fallback', async () => {
  assert.equal((await worker.fetch(new Request(`${origin}/api/nope`), env)).status, 404);
  const response = await worker.fetch(new Request(`${origin}/`), { ASSETS: { fetch: async () => new Response('homepage') } });
  assert.equal(await response.text(), 'homepage');
});
