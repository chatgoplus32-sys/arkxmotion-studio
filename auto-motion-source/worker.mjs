const ALLOWED_VOICES = new Set([
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
]);

// Transcript and delivery must stay separate: these directions are never narration.
const DELIVERY = {
  natural: 'natural, clear, conversational',
  warm: 'warm, friendly, sincere',
  energetic: 'energetic, confident, lively',
  calm: 'calm, gentle, unhurried',
  professional: 'professional, clear, confident',
  storytelling: 'expressive, engaging storytelling',
};
const TTS_MODEL = 'gemini-3.8-flash-tts';
const MAX_TEXT_CHARS = 2500;
const MAX_BODY_BYTES = 18000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 6;
const rateBuckets = new Map();

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function allowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

function rateLimit(ip) {
  const now = Date.now();
  const prior = rateBuckets.get(ip);
  if (!prior || now - prior.start >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
  } else if (prior.count >= RATE_LIMIT) {
    return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - prior.start)) / 1000));
  } else prior.count += 1;
  if (rateBuckets.size > 3000) {
    for (const [key, value] of rateBuckets) {
      if (now - value.start >= RATE_WINDOW_MS) rateBuckets.delete(key);
      if (rateBuckets.size <= 2500) break;
    }
  }
  return 0;
}

async function readBoundedBody(request) {
  const announced = Number(request.headers.get('Content-Length') || 0);
  if (announced > MAX_BODY_BYTES) throw new RangeError('body-too-large');
  if (!request.body) throw new TypeError('body-missing');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError('body-too-large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function isWav(bytes) {
  return bytes.length >= 44 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WAVE';
}

function wrapPcmAsWav(pcm, sampleRate = 24000) {
  if (!pcm.length || pcm.length % 2) throw new Error('invalid-pcm');
  const wav = new Uint8Array(44 + pcm.length);
  const view = new DataView(wav.buffer);
  const write = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return wav;
}

async function createVoice(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (!allowedOrigin(request)) return jsonResponse({ error: 'origin_denied' }, 403);
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return jsonResponse({ error: 'content_type_invalid' }, 415);
  }
  if (!env.GEMINI_API_KEY) return jsonResponse({ error: 'tts_not_configured' }, 503);
  let input;
  try { input = JSON.parse(await readBoundedBody(request)); }
  catch (error) {
    return jsonResponse({ error: error instanceof RangeError ? 'request_too_large' : 'invalid_json' }, error instanceof RangeError ? 413 : 400);
  }
  const text = typeof input?.text === 'string' ? input.text.trim() : '';
  const voice = typeof input?.voice === 'string' ? input.voice : '';
  const delivery = typeof input?.delivery === 'string' ? input.delivery : 'natural';
  if (!text) return jsonResponse({ error: 'text_required' }, 400);
  if (text.length > MAX_TEXT_CHARS) return jsonResponse({ error: 'text_too_long', maxChars: MAX_TEXT_CHARS }, 413);
  if (!ALLOWED_VOICES.has(voice)) return jsonResponse({ error: 'voice_invalid' }, 400);
  if (!Object.hasOwn(DELIVERY, delivery)) return jsonResponse({ error: 'delivery_invalid' }, 400);
  const retryAfter = rateLimit(request.headers.get('CF-Connecting-IP') || 'unknown');
  if (retryAfter) return jsonResponse({ error: 'rate_limited' }, 429, { 'Retry-After': String(retryAfter) });

  let upstream;
  try {
    upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text, speech_metadata: { style: DELIVERY[delivery] } }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          responseFormat: { audio: { mimeType: 'AUDIO_WAV', sampleRate: 24000 } },
          speechConfig: { voiceConfig: { voice } },
        },
      }),
      signal: AbortSignal.timeout(75000),
    });
  } catch (error) {
    return jsonResponse({ error: error.name === 'TimeoutError' || error.name === 'AbortError' ? 'tts_timeout' : 'tts_unavailable' }, 502);
  }
  if (!upstream.ok) {
    // Never relay upstream bodies: they can contain sensitive request/auth details.
    if (upstream.status === 429) return jsonResponse({ error: 'tts_quota' }, 429, { 'Retry-After': '30' });
    if (upstream.status === 401 || upstream.status === 403) return jsonResponse({ error: 'tts_permission_denied' }, 502);
    if (upstream.status === 404) return jsonResponse({ error: 'tts_model_unavailable' }, 502);
    if (upstream.status === 400) return jsonResponse({ error: 'tts_request_rejected' }, 422);
    return jsonResponse({ error: 'tts_unavailable' }, 502);
  }
  let response;
  try { response = await upstream.json(); }
  catch { return jsonResponse({ error: 'tts_empty' }, 502); }
  const parts = response?.candidates?.[0]?.content?.parts || [];
  const audioPart = parts.find((part) => part?.inlineData?.data || part?.inline_data?.data);
  const encoded = audioPart?.inlineData?.data || audioPart?.inline_data?.data;
  if (!encoded) return jsonResponse({ error: 'tts_empty' }, 502);
  try {
    const binary = atob(encoded);
    let bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const mime = (audioPart?.inlineData?.mimeType || audioPart?.inline_data?.mime_type || '').toLowerCase();
    if (!isWav(bytes) && /^audio\/(l16|pcm)(;|$)/.test(mime)) {
      const rate = Number(mime.match(/rate=(\d+)/)?.[1] || 24000);
      bytes = wrapPcmAsWav(bytes, [8000, 16000, 22050, 24000, 44100, 48000].includes(rate) ? rate : 24000);
    }
    if (!isWav(bytes)) return jsonResponse({ error: 'tts_format_invalid' }, 502);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'audio/wav', 'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline; filename="arkx-auto-motion-voice-over.wav"',
      },
    });
  } catch { return jsonResponse({ error: 'tts_format_invalid' }, 502); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/tts/status' && request.method === 'GET') {
      return jsonResponse({ configured: Boolean(env.GEMINI_API_KEY), maxChars: MAX_TEXT_CHARS });
    }
    if (url.pathname === '/api/tts') return createVoice(request, env);
    if (url.pathname.startsWith('/api/')) return jsonResponse({ error: 'not_found' }, 404);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  },
};
