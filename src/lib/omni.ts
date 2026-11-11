export const OMNI_MODEL = 'gemini-omni-1.2-flash';
export const OMNI_DURATION = '15s';
export const OMNI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const GOOGLE_ORIGIN = 'https://generativelanguage.googleapis.com';

export type OmniOptions = {
  idea: string;
  visualStyle: string;
  hookTechnique: string;
  aspectRatio: '9:16' | '16:9';
};

export function buildOmniRequest(options: OmniOptions) {
  if (!options.idea.trim()) throw new Error('Masukkan topik atau ide video terlebih dahulu.');
  if (!['9:16', '16:9'].includes(options.aspectRatio)) throw new Error('Rasio video tidak valid.');
  return {
    model: OMNI_MODEL,
    input: `Create one complete 15-second health education video with synchronized native audio, not a script or JSON.\nTopic / user direction: ${options.idea.trim()}\nVisual style: ${options.visualStyle}. Use cute anthropomorphic organs or cells strictly inside the human body; no real people talking.\nSingle 15-second timeline: 0–4s attention-grabbing HOOK using ${options.hookTechnique}; 4–11s clear explanatory BODY; 11–15s concise CTA. Use cinematic wide, close-up, tracking, and macro shots when appropriate.\nSpoken narration: natural Indonesian, concise enough to finish within 15 seconds. Keep narration and visual action synchronized. No medical diagnosis, treatment guarantees, or exaggerated health claims. Use an educational tone.`,
    response_format: {
      type: 'video',
      duration: OMNI_DURATION,
      aspect_ratio: options.aspectRatio,
      resolution: '720p',
      delivery: 'uri'
    },
    store: false
  };
}

export function findOmniVideo(interaction: any) {
  for (const step of interaction?.steps || []) {
    if (step?.type !== 'model_output') continue;
    const video = (step.content || []).find((item: any) => item?.type === 'video' && (item.data || item.uri));
    if (video) return video;
  }
  throw new Error('Respons Google belum berisi video pada steps.model_output. Tidak ada permintaan ulang otomatis.');
}

export function getGoogleFileUrls(uri: string) {
  let parsed: URL;
  try { parsed = new URL(uri); } catch { throw new Error('URI video Google tidak valid.'); }
  if (parsed.origin !== GOOGLE_ORIGIN || parsed.username || parsed.password) throw new Error('URI video ditolak: hanya host resmi Google yang diperbolehkan.');
  const match = parsed.pathname.match(/^\/v1beta\/files\/([A-Za-z0-9_-]+)(?::download)?$/);
  if (!match) throw new Error('Format URI file video Google tidak dikenali.');
  const filePath = `${GOOGLE_ORIGIN}/v1beta/files/${match[1]}`;
  return { metadata: filePath, download: `${filePath}:download?alt=media` };
}

export type OmniDependencies = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onStatus?: (status: string) => void;
  signal?: AbortSignal;
};

export async function generateOmniVideo(options: OmniOptions & { apiKey: string }, dependencies: OmniDependencies = {}) {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('Tambahkan API key Gemini Anda pada Pengaturan AI.');
  const payload = buildOmniRequest(options);
  const fetchImpl = dependencies.fetchImpl || fetch;
  const sleep = dependencies.sleep || ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  const headers = { 'x-goog-api-key': apiKey };
  const requestOptions: RequestInit = { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: dependencies.signal };
  const safeMessage = (message: string) => message.split(apiKey).join('[key disembunyikan]').slice(0, 500);
  const readJson = async (response: Response, operation: string) => {
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(safeMessage(data?.error?.message || `${operation} gagal (HTTP ${response.status}).`));
    return data;
  };

  dependencies.onStatus?.('Google sedang membuat satu video 15 detik…');
  // Exactly one POST per confirmed action. Never auto-retry a potentially billable request.
  let createResponse: Response;
  try {
    createResponse = await fetchImpl(OMNI_API_URL, {
      ...requestOptions,
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error('Koneksi generasi terputus. Status dan biaya request mungkin belum diketahui. Periksa akun Google sebelum mencoba lagi; aplikasi tidak mengulang otomatis.');
  }
  const interaction = await readJson(createResponse, 'Generasi video');
  if (interaction?.status === 'failed' || interaction?.status === 'cancelled') {
    throw new Error(safeMessage(interaction?.error?.message || 'Google tidak menyelesaikan generasi video.'));
  }
  const output = findOmniVideo(interaction);
  const mimeType = output.mime_type || 'video/mp4';
  let blob: Blob;

  if (output.data) {
    dependencies.onStatus?.('Menyiapkan video untuk diputar…');
    try {
      const chars = atob(output.data)
      const bytes = new Uint8Array(chars.length)
      for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i)
      blob = new Blob([bytes], { type: mimeType })
    } catch { throw new Error('Data video base64 dari Google tidak valid.'); }
  } else {
    const urls = getGoogleFileUrls(output.uri);
    dependencies.onStatus?.('Menunggu file video Google siap…');
    let active = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const info = await readJson(await fetchImpl(urls.metadata, { ...requestOptions, method: 'GET', headers }), 'Pemeriksaan file');
      const state = typeof info?.state === 'string' ? info.state : info?.state?.name;
      if (state === 'ACTIVE') { active = true; break; }
      if (state === 'FAILED') throw new Error('Pemrosesan file video Google gagal. Tidak ada permintaan generasi ulang.');
      if (state !== 'PROCESSING' && state !== 'STATE_UNSPECIFIED') throw new Error('Status file video Google tidak dikenali. Tidak ada permintaan generasi ulang.');
      if (attempt < 59) await sleep(5000);
    }
    if (!active) throw new Error('File belum siap setelah 5 menit. Generasi tidak diulang otomatis; periksa akun Google sebelum mencoba lagi.');
    dependencies.onStatus?.('Mengunduh MP4 dari Google…');
    const download = await fetchImpl(urls.download, { ...requestOptions, method: 'GET', headers });
    if (!download.ok) throw new Error(`Unduhan video gagal (HTTP ${download.status}). Tidak ada permintaan generasi ulang.`);
    const downloadedBlob = await download.blob();
    blob = new Blob([downloadedBlob], { type: mimeType });
  }
  if (!blob.size) throw new Error('Google mengembalikan file video kosong.');
  return { blob, interactionId: interaction.id || '', model: OMNI_MODEL, duration: OMNI_DURATION, aspectRatio: options.aspectRatio };
}
