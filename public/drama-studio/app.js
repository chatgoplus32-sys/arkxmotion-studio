(() => {
  'use strict';
  const KEY = 'arkx-drama-studio-v2-local';
  const PROVIDERS = ['NexaBot (Omni Flash 1.2)', 'Gemini', 'ChatGPT', 'Google Flow', 'Grok'];
  const PAGE_NAMES = {dashboard:'Ringkasan',story:'AI Story',storyboard:'Storyboard',queue:'Prompt queue',workspace:'Story workspace'};
  const STATUS = {draft:'Draft',ready:'Siap disalin',copied:'Disalin manual'};
  const $ = (s, r=document) => r.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const makeId = () => Math.random().toString(36).slice(2,10);
  const slug = s => String(s || 'arkx-story').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'arkx-story';
  const blankProject = name => ({id:makeId(),name:name || 'Cerita baru',description:'',style:'Drama sinematik',template:'Micro drama · 3 babak',created:Date.now(),characters:[],scenes:[],queue:[],story:{premise:'',template:'Micro drama · 3 babak'}});
  // ══════════════ Integrasi AI: Gemini (story/prompt) · NexaBot (gambar, video) ═══
  // - Story / prompt: pakai relay studio-ai (Gemini server-side, member tak perlu key)
  // - Gambar: Nano Banana Pro via nexabot.id/gpt-image (model nano_banana_pro, 0,1 kredit, member pakai API key NexaBot sendiri)
  // - Video drama: Omni Flash 1.2 (model omni_flash) via relay /api/public/nexabot (member key)
  const LS_TOKEN = 'arkxmotion_token', LS_REFRESH = 'arkxmotion_refresh';
  const isTokenFresh = (t) => {
    try { const p = t.split('.')[1]; const d = JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/'))); return d.exp && d.exp * 1000 > Date.now() + 60_000; } catch { return false }
  };
  async function appToken() {
    let t = null; try { t = localStorage.getItem(LS_TOKEN) } catch {}
    if (t && isTokenFresh(t)) return t;
    try {
      const rt = localStorage.getItem(LS_REFRESH); if (!rt) return null;
      const res = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) });
      if (!res.ok) return null;
      const d = await res.json().catch(() => null); const nt = d?.token;
      if (nt) { try { localStorage.setItem(LS_TOKEN, nt) } catch {}; return nt }
      return null;
    } catch { return null }
  }
  const memberKey = () => {
    try {
      const keys = (JSON.parse(localStorage.getItem('arkxmotion.providers') || '{}').nexabot || []);
      const active = keys.find(k => k && (k.status === 'active' || k.status === 'unknown'));
      return active?.key || (keys[0]?.key || null);
    } catch { return null }
  };
  const aspectEnum = (ratio) => ratio === '1:1' ? 1 : ratio === '16:9' ? 2 : 5; // 1=1:1, 2=16:9, 5=9:16 (enum nexabot)
  const ratioSubmit = (ratio) => ratio === '16:9' ? 1 : 2; // ratio 1 = 16:9, 2 = 9:16
  // Prompt video selalu dibarengi kalimat voiceover agar Omni Flash 1.2
  // MEMBUNYIKAN narasi (seperti fix Arkx Health Animasi) — Bahasa Indonesia.
  const withVoiceover = (prompt, voiceover) => {
    const vo = String(voiceover || '').trim();
    const body = String(prompt || '').trim();
    if (!vo) return body;
    if (/voiceover[^.]*(Indonesian|Bahasa Indonesia)/i.test(body)) return body;
    return `${body}\nA voiceover narrates in Indonesian (Bahasa Indonesia), warm and friendly tone, saying exactly: "${vo}". No English speech.`;
  };
  const slugify = s => String(s || 'clip').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0, 60) || 'clip';
  const runningOps = new Set();
  const opRunning = key => runningOps.has(key);
  const setRunning = (key, val) => { if (val) runningOps.add(key); else runningOps.delete(key) };
  // ── Merge video via ffmpeg.wasm (persis pola Watermark Remover) ───────────
  let ffmpegCache = null;
  const loadFfmpeg = async () => {
    if (ffmpegCache) return ffmpegCache;
    const loadScript = (src) => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('Gagal memuat ffmpeg.wasm — periksa koneksi'));
      document.head.appendChild(s);
    });
    await loadScript('https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/umd/ffmpeg.js');
    await loadScript('https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js');
    const { FFmpeg } = window.FFmpegWASM;
    const { toBlobURL, fetchFile } = window.FFmpegUtil;
    const ffmpeg = new FFmpeg();
    const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffmpegCache = { ffmpeg, fetchFile };
    return ffmpegCache;
  };
  async function fetchRemoteVideoFile(url, name) {
    const tryFetch = async (target) => {
      const res = await fetch(target);
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok || ct.includes('text/html')) return null;
      const blob = await res.blob();
      return blob && blob.size > 1024 ? blob : null;
    };
    let blob = null;
    try { blob = await tryFetch(url); } catch { /* CORS — lanjut ke proxy */ }
    if (!blob) {
      const res = await fetch(`/api/public/video-proxy?url=${encodeURIComponent(url)}`);
      if (res.ok) blob = await res.blob();
    }
    if (!blob || blob.size < 1024) throw new Error(`Gagal mengunduh ${name}`);
    return new File([blob], name, { type: 'video/mp4' });
  }
  const mergedVideos = new Map(); // projectId -> { name, size, url, scenes }
  let mergeStage = '';
  const setMergeStage = (t) => {
    mergeStage = t || '';
    document.querySelectorAll('[data-drama-action="merge-all"]').forEach(b => {
      b.disabled = !!t;
      b.innerHTML = t ? esc(t) : '🎬 Gabung jadi 1 Video (ffmpeg)';
    });
  };

  // ── Gemini via relay studio-ai (member login, key server) ───────────────────
  async function geminiJSON({ prompt, system, schema, models }) {
    const token = await appToken(); if (!token) throw new Error('Sesi berakhir — login ulang untuk memakai AI.');
    const list = models || ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-flash-latest'];
    let last = 'Gagal menjawab.';
    for (const model of list) {
      try {
        const res = await fetch(`/api/public/studio-ai/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: system }] },
            generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.7, topP: 0.95, topK: 40 },
          }),
        });
        if (!res.ok) { const t = await res.text().catch(() => ''); last = `HTTP ${res.status} ${t.slice(0,140)}`; continue; }
        const j = await res.json();
        const text = ((j.candidates?.[0]?.content?.parts) || []).filter(p => !p.thought).map(p => p.text || '').join('');
        if (!text) { last = 'Model mengembalikan jawaban kosong.'; continue; }
        try { return JSON.parse(text); } catch { last = `Format jawaban ${model} tidak valid.`; continue }
      } catch (e) { last = e?.message || String(e) }
    }
    throw new Error(last);
  }

  // ── NexaBot (member pakai API key sendiri dari halaman Providers) ───────────
  // Relay boleh menjawab 429 { ok:false, queued:true, retry_after_seconds } saat
  // lane penuh (mis. sesi server/unlimited lagi mengerjakan satu job). App
  // menunggu sejumlah detik itu lalu mencoba lagi otomatis — persis janji
  // di pesan relay ("Permintaan Anda dicoba lagi otomatis dalam N detik").
  // Batas percobaan diperbesar (16) supaya job video ~3-5 menit bisa menunggu
  // job sebelumnya selesai tanpa member kehabisan kesabaran aplikasi.
  async function nexabotSubmitT2v({ prompt, ratio, resolution = 720, duration = 15, onQueueWait }) {
    const k = memberKey(); if (!k) throw new Error('API key NexaBot belum diisi — tambahkan di halaman Providers.');
    const MAX_429 = 16;
    for (let attempt = 1; ; attempt++) {
      const t = await appToken();
      const res = await fetch('/api/public/nexabot/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': k, ...(t ? { Authorization: 'Bearer ' + t } : {}) },
        body: JSON.stringify({ mode: 't2v', prompt, ratio: ratioSubmit(ratio), resolution, duration }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 429 && data?.queued) {
        const waitSec = Math.min(Math.max(Number(data?.retry_after_seconds) || 30, 5), 180);
        onQueueWait?.(waitSec, attempt);
        if (attempt >= MAX_429) throw new Error(`Antrian NexaBot sedang penuh — coba lagi beberapa saat lagi, atau pasang API key NexaBot milikmu sendiri di Providers agar jalurnya tidak antre sesi server.`);
        await new Promise(r => setTimeout(r, (waitSec + 2) * 1000));
        continue;
      }
      if (!res.ok || !data?.ok) throw new Error(data?.error || data?.errorMessage || `Submit gagal (HTTP ${res.status})`);
      const jobId = data.jobId || data.id || data.taskId || data.data?.jobId || data.data?.id;
      if (!jobId) throw new Error('Submit tidak mengembalikan job id.');
      return jobId;
    }
  }
  async function nexabotPollJob(jobId, onStatus, maxMs = 25 * 60 * 1000) {
    const k = memberKey(); const start = Date.now(); let delay = 2000;
    for (;;) {
      if (Date.now() - start > maxMs) throw new Error('Polling timeout — cek job di nexabot.id.');
      const t = await appToken();
      const res = await fetch('/api/public/nexabot/job/' + encodeURIComponent(jobId), {
        headers: { 'x-api-key': k || '', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      });
      if (res.ok) {
        const data = await res.json().catch(() => null); const job = data?.job || data || {};
        const status = String(job.status || '').toLowerCase();
        if (['done','completed','success','succeeded'].includes(status)) return job;
        if (['failed','error','cancelled','canceled'].includes(status)) throw new Error('Job gagal: ' + (job.error || 'Unknown error'));
        onStatus?.(`NexaBot: ${status}${job.progress ? ' ' + job.progress + '%' : ''}`);
      } else if (res.status === 400 || res.status === 401 || res.status === 403) {
        const t2 = await res.text().catch(() => ''); throw new Error('NexaBot menolak kredensial — cek API key di Providers (' + (t2 || res.status).slice(0, 80) + ')');
      }
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(Math.round(delay * 1.5), 8000);
    }
  }
  async function nexabotSaveVideo(jobId, filename) {
    const k = memberKey(); const t = await appToken(); if (!t) throw new Error('Sesi berakhir — silakan login ulang.');
    const res = await fetch('/api/public/nexabot/save/' + encodeURIComponent(jobId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': k || '', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ filename }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok || !data?.url) throw new Error(data?.error || `Simpan gagal (HTTP ${res.status})`);
    return data.url;
  }
  async function gptImageJob({ prompt, aspect = 5, references = [], model = 'nano_banana_pro', onQueueWait }) {
    const k = memberKey(); if (!k) throw new Error('API key NexaBot belum diisi — tambahkan di halaman Providers.');
    const MAX_429 = 16;
    for (let attempt = 1; ; attempt++) {
      const t = await appToken();
      const res = await fetch('/api/public/nexabot/gpt-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': k, ...(t ? { Authorization: 'Bearer ' + t } : {}) },
        // Model default NexaBot untuk gambar: Nano Banana Pro (0,1 kredit) —
        // konsisten dengan katalog gambar NexaBot (semua 0,1 cr).
        body: JSON.stringify({ prompt, aspect, references: (Array.isArray(references) ? references : []).slice(0, 10), model }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 429 && data?.queued) {
        const waitSec = Math.min(Math.max(Number(data?.retry_after_seconds) || 30, 5), 180);
        onQueueWait?.(waitSec, attempt);
        if (attempt >= MAX_429) throw new Error(`Antrian NexaBot/sesi server sedang penuh — coba lagi nanti, atau pasang API key NexaBot milikmu sendiri di Providers agar tidak ikut antre sesi server.`);
        await new Promise(r => setTimeout(r, (waitSec + 2) * 1000));
        continue;
      }
      if (!res.ok || !data?.ok) throw new Error(data?.error || data?.errorMessage || `Submit Nano Banana Pro gagal (HTTP ${res.status})`);
      return data.id || data.jobId || data.data?.id;
    }
  }
  async function gptImagePoll(jobId, onStatus, maxMs = 10 * 60 * 1000) {
    const k = memberKey(); const start = Date.now(); let delay = 2500;
    for (;;) {
      if (Date.now() - start > maxMs) throw new Error('Polling timeout.');
      const t = await appToken();
      const res = await fetch('/api/public/nexabot/gpt-image/' + encodeURIComponent(jobId), {
        headers: { 'x-api-key': k || '', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      });
      if (res.ok) {
        const data = await res.json().catch(() => null); const job = data?.job || data || {};
        const status = String(job.status || '').toLowerCase();
        if (['done','completed','success','succeeded'].includes(status)) return job;
        if (['failed','error','cancelled','canceled'].includes(status)) throw new Error('Nano Banana Pro gagal: ' + (job.error || 'Unknown error'));
        onStatus?.(`Nano Banana Pro: ${status}${job.progress ? ' ' + job.progress + '%' : ''}`);
      } else if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new Error('NexaBot menolak kredensial — cek API key di Providers.');
      }
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(Math.round(delay * 1.4), 7000);
    }
  }
  async function gptImageDownloadBlob(jobId, index = 0) {
    const k = memberKey(); const t = await appToken();
    const res = await fetch(`/api/public/nexabot/gpt-image/${encodeURIComponent(jobId)}/download?index=${index}`, {
      headers: { 'x-api-key': k || '', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    });
    if (!res.ok) throw new Error(`Unduh gambar gagal (HTTP ${res.status})`);
    return res.blob();
  }
  function downscaleToDataUrl(blob, maxPx = 1024) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img; const scale = Math.min(1, maxPx / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale)); height = Math.max(1, Math.round(height * scale));
        const c = document.createElement('canvas'); c.width = width; c.height = height;
        c.getContext('2d').drawImage(img, 0, 0, width, height);
        let q = 0.82, out = c.toDataURL('image/jpeg', q);
        while (out.length > 760 * 1024 * 1.37 && q > 0.35) { q = Math.max(0.35, q - 0.15); out = c.toDataURL('image/jpeg', q); }
        URL.revokeObjectURL(img.src); resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('Gambar tidak bisa dibuka.')); };
      img.src = URL.createObjectURL(blob);
    });
  }
  const demo = () => {
    const p = blankProject('Malam di Stasiun');
    p.description='Sebuah pesan suara lama mengubah perjalanan pulang Nara.';
    p.style='Drama sinematik';
    p.template='Serial vertikal · 5 adegan';
    p.story={premise:p.description,template:'Serial vertikal · 5 adegan'};
    p.characters=[{id:makeId(),name:'Nara',description:'Fotografer malam yang selalu menyimpan satu pesan yang belum terkirim.'},{id:makeId(),name:'Bima',description:'Adik Nara, hangat, terus terang, dan menyimpan kabar penting.'}];
    p.scenes=[
      {id:makeId(),title:'01 · Platform terakhir',action:'Kereta malam menjauh. Nara menemukan ponsel lama di bangku kosong.',dialogue:'Nara: “Ini seharusnya sudah hilang.”',prompt:'Cinematic medium shot, quiet Indonesian train platform at night, a young woman finds an old phone on an empty bench, wet floor catching violet and mint station lights, restrained film grain, emotional stillness.',reference:null},
      {id:makeId(),title:'02 · Pesan yang tertunda',action:'Layar ponsel menyala. Ada satu rekaman suara yang belum pernah ia dengar.',dialogue:'Bima (rekaman): “Kalau kamu mendengar ini, jangan pulang dulu.”',prompt:'Close-up of a glowing phone in a woman’s hand, blurred station lights behind, tense intimate framing, cinematic shallow depth of field.',reference:null},
      {id:makeId(),title:'03 · Keputusan',action:'Nara memandang papan jadwal lalu berbalik menuju pintu keluar.',dialogue:'Nara: “Kali ini aku akan mendengarkan.”',prompt:'Wide cinematic shot, lone woman turning from the departing train toward a softly lit station exit, hopeful violet dawn, dramatic negative space.',reference:null}
    ];
    p.queue=[
      {id:makeId(),sceneId:p.scenes[0].id,title:'01 · Platform terakhir',prompt:p.scenes[0].prompt,provider:'Google Flow',ratio:'9:16',resolution:'1080p',duration:'8 detik',variations:'1',status:'ready',result:null,order:0},
      {id:makeId(),sceneId:p.scenes[1].id,title:'02 · Pesan yang tertunda',prompt:p.scenes[1].prompt,provider:'Gemini',ratio:'9:16',resolution:'1080p',duration:'8 detik',variations:'1',status:'draft',result:null,order:1},
      {id:makeId(),sceneId:p.scenes[2].id,title:'03 · Keputusan',prompt:p.scenes[2].prompt,provider:'ChatGPT',ratio:'16:9',resolution:'1080p',duration:'8 detik',variations:'1',status:'draft',result:null,order:2}
    ];
    return p;
  };
  async function aiGenerateStory() {
    const p = project(); if (!p) return;
    const template = $('[data-story-template]:checked')?.value || $('[data-story-field="template"]')?.value || p.story?.template || 'Micro drama · 3 babak';
    const beats = template.includes('5') ? 5 : template.includes('4') ? 4 : 3;
    const premise = ($('[data-story-field="premise"]')?.value || p.story?.premise || p.description || '').trim();
    if (!premise) { toast('Isi premis / ide utama dulu, baru klik Buat dengan AI.'); return; }
    if (opRunning('ai-story')) return;
    if (p.scenes.length && !confirm('Storyboard sudah berisi adegan. Ganti seluruh isi dengan cerita AI?')) return;
    setRunning('ai-story', true);
    const btns = document.querySelectorAll('[data-drama-action="ai-story"]');
    btns.forEach(b => { b.disabled = true; b.textContent = '✨ Menulis cerita AI… (30–90 dtk)'; });
    try {
      const schema = {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          premise: { type: 'STRING' },
          description: { type: 'STRING' },
          style: { type: 'STRING' },
          characters: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, description: { type: 'STRING' } }, required: ['name'] } },
          scenes: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { title: { type: 'STRING' }, action: { type: 'STRING' }, dialogue: { type: 'STRING' }, voiceover: { type: 'STRING' }, prompt: { type: 'STRING' }, video_prompt: { type: 'STRING' } },
              required: ['title', 'prompt', 'voiceover'],
            },
          },
        },
        required: ['title', 'premise', 'scenes'],
      };
      const sys = 'Anda penulis skenario drama vertikal Indonesia untuk format video pendek (TikTok/Reels/Shorts). Jawab HANYA JSON sesuai skema. Judul, narasi (voiceover), aksi, dan dialog dalam Bahasa Indonesia; setiap adegan menyertakan voiceover (Narasi/VO) Bahasa Indonesia yang singkat (1 kalimat, muat diucapkan dalam 15 detik), prompt sinematik BAHASA INGGRIS (prompt) untuk gambar still dan prompt sinematik BAHASA INGGRIS (video_prompt) untuk video generator — sebutkan kamera, pergerakan kamera, lighting, suasana; TANPA teks berbahasa apa pun di dalam video (gambar & adegan tidak boleh ada tulisan). Karakter konsisten secara visual antar adegan (sebutkan pakaian, usia, ciri fisik di tiap adegan). Tidak ada klaim kesehatan berlebihan. Tanpa pornografi/kekerasan eksplisit. Jangan pakai trademark asli.';
      const userPrompt = `Premis: ${premise}\nTemplate: ${template} → tepat ${beats} adegan (adegan 1 = hook yang membuat berhenti scroll, adegan ${beats} = cliffhanger/CTA singkat, di antaranya satu poin cerita per adegan).\nGaya visual: ${p.style || 'Drama sinematik'}.\n\nKembalikan JSON sesuai skema: title (judul cerita mengejutkan, maks 60 karakter), premise (1 kalimat tajam), description (sinopsis 1-2 kalimat), style (gaya visual Inggris atau Indonesia — bebas, singkat), characters (2-4 tokoh; name; description pendek mencakup usia, penampilan, pakaian, sifat), scenes (tepat ${beats} adegan; title; action (apa yang terlihat, 2-4 kalimat, Bahasa Indonesia); dialogue (dialog singkat tokoh utama dengan tanda kutip, Bahasa Indonesia); voiceover (NARASI/VO Bahasa Indonesia — 1 kalimat pendek yang diucapkan narrator di adegan ini, SELALU Bahasa Indonesia); prompt (EN, sinematic still, sebut kamera/angle/lens/kualitas, 1 paragraf); video_prompt (EN, cinematic video 15 detik, sebut kamera, pergerakan, lighting, mood, 1 paragraf — JANGAN sebut suara/VO di sini, VO diatur lewat voiceover)). Judul adegan diawali nomor urut (01/02/...). Semua prompt Inggris; aksi, dialog & VO Indonesia.`;
      const parsed = await geminiJSON({ prompt: userPrompt, system: sys, schema });
      p.name = parsed.title ? String(parsed.title).trim().slice(0, 120) : p.name;
      p.description = String(parsed.description || parsed.premise || premise || '').trim().slice(0, 500);
      p.story = { premise: String(parsed.premise || premise || '').trim(), template };
      p.template = template;
      if (Array.isArray(parsed.characters) && parsed.characters.length) {
        p.characters = parsed.characters.slice(0, 8).map(c => ({ id: makeId(), name: String(c.name || 'Tokoh').slice(0, 60), description: String(c.description || '').slice(0, 500) }));
      }
      const scenes = Array.isArray(parsed.scenes) ? parsed.scenes.slice(0, beats) : [];
      if (!scenes.length) throw new Error('Gemini tidak mengembalikan adegan. Coba premis yang lebih spesifik.');
      p.scenes = scenes.map((s, i) => ({
        id: makeId(),
        title: String(s.title || `Adegan ${String(i + 1).padStart(2, '0')}`).slice(0, 120),
        action: String(s.action || '').trim(),
        dialogue: String(s.dialogue || '').trim(),
        voiceover: String(s.voiceover || '').trim(),
        prompt: String(s.prompt || '').trim(),
        video_prompt: String(s.video_prompt || '').trim(),
        reference: null,
      }));
      p.queue = p.scenes.map((s, i) => ({
        id: makeId(), sceneId: s.id,
        title: s.title, prompt: s.video_prompt || s.prompt || s.action,
        voiceover: s.voiceover || '',
        provider: 'NexaBot (Omni Flash 1.2)', ratio: '9:16', resolution: '720p', duration: '15 detik', variations: '1',
        status: 'ready', result: null, order: i, genStatus: '',
      }));
      persist(); state.page = 'storyboard'; render();
      toast(`Cerita AI siap: ${p.scenes.length} adegan + ${p.queue.length} prompt video di antrean. Klik ⚡ Generate di halaman Prompt queue.`);
    } catch (e) {
      toast(`AI Story gagal: ${e?.message || e}`);
    } finally {
      setRunning('ai-story', false);
      btns.forEach(b => { b.disabled = false; b.textContent = '✨ Buat cerita dengan AI'; });
      persist();
    }
  }

  async function aiGenerateSceneImage(sceneId, triggerBtn) {
    const p = project(); const s = p?.scenes.find(x => x.id === sceneId); if (!s) return;
    if (opRunning('img-' + sceneId)) return;
    const artPrompt = (s.prompt || s.action || '').trim();
    if (!artPrompt) { toast('Isi aksi / prompt visual adegan dulu.'); return; }
    if (!memberKey()) { toast('API key NexaBot belum diisi — tambahkan di halaman Providers.'); return; }
    const aspectRatio = ($('[data-default-ratio]')?.value) || '9:16';
    const aspect = aspectEnum(aspectRatio);
    setRunning('img-' + sceneId, true);
    if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = '📷 Membuat…'; }
    try {
      const prompt = `${artPrompt}. Vertical cinematic composition, dramatic lighting, photorealistic film still, high detail, no text, no watermark, no subtitle.`;
      const jobId = await gptImageJob({
        prompt,
        aspect,
        onQueueWait: (waitSec, attempt) => { s.genStatus = `⏳ Antrian NexaBot penuh (sesi server) — tunggu ${waitSec}s (${attempt}/16)…`; persist(); render(); },
      });
      const job = await gptImagePoll(jobId, m => { s.genStatus = m; persist(); render(); });
      const images = Array.isArray(job.images) ? job.images : [];
      if (!images.length) throw new Error('Job selesai tapi tidak ada gambar kembali.');
      const idx = images.findIndex(im => im && (im.url || im.index != null));
      const targetIdx = idx >= 0 ? idx : 0;
      const blob = await gptImageDownloadBlob(jobId, targetIdx);
      s.reference = await downscaleToDataUrl(blob, 1024);
      s.genStatus = '';
      persist(); render();
      toast('Gambar referensi adegan dibuat (Nano Banana Pro).');
    } catch (e) {
      s.genStatus = '';
      persist(); render();
      toast(`Gagal membuat gambar: ${e?.message || e}`);
    } finally {
      setRunning('img-' + sceneId, false);
      if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.innerHTML = '📷 Nano Banana Pro'; }
    }
  }

  async function aiGenerateVideoForQueueItem(q, triggerBtn) {
    const p = project(); if (!p || !q) return;
    if (q.genStatus === 'running' || q.genStatus === 'polling') return;
    if (fRunningSoon(q)) return;
    if (!memberKey()) { toast('API key NexaBot belum diisi — tambahkan di halaman Providers.'); return; }
    if (!q.prompt || !String(q.prompt).trim()) { toast('Isi prompt video dulu.'); return; }
    setRunning('vid-' + q.id, true);
    if (triggerBtn) { triggerBtn.disabled = true; }
    const setStatus = m => { q.genStatus = m; persist(); render(); };
    try {
      // Narasi dibaca langsung dari kartu adegan (bila tertaut) supaya edit terbaru
      // selalu dipakai; fallback ke salinan di antrean.
      const sceneVo = (() => {
        try {
          if (q.sceneId && project()) {
            const s = project().scenes.find(x => x.id === q.sceneId);
            if (s && String(s.voiceover || '').trim()) return String(s.voiceover).trim();
          }
          return String(q.voiceover || '').trim();
        } catch { return String(q.voiceover || '').trim() }
      })();
      setStatus('Mengirim ke Omni Flash 1.2…');
      const jobId = await nexabotSubmitT2v({
        prompt: withVoiceover(q.prompt, sceneVo),
        ratio: q.ratio || '9:16', resolution: 720, duration: 15,
        onQueueWait: (waitSec, attempt) => setStatus(`⏳ Antrian NexaBot penuh (sesi server) — tunggu ${waitSec}s (percobaan ${attempt}/16)…`),
      });
      setStatus(`Video sedang dibuat Omni Flash (job ${String(jobId).slice(0, 8)}…)`);
      await nexabotPollJob(jobId, s => setStatus(s));
      setStatus('Menyimpan hasil ke server…');
      const url = await nexabotSaveVideo(jobId, `${slugify(q.title || 'klip')}-${Date.now()}.mp4`);
      q.result = { name: `${slugify(q.title || 'klip')}.mp4`, type: 'video/mp4', data: url };
      q.status = 'copied';
      setStatus('done');
      return true;
    } catch (e) {
      setStatus('error: ' + String(e?.message || e).slice(0, 100));
      return false;
    } finally {
      setRunning('vid-' + q.id, false);
      persist(); render();
    }
  }
  const fRunningSoon = q => runningOps.has('vid-' + q.id);

  async function aiGenerateAllVideos() {
    const p = project(); if (!p) return;
    if (!memberKey()) { toast('API key NexaBot belum diisi — tambahkan di halaman Providers.'); return; }
    const items = [...p.queue].filter(q => !(q.result && q.result.data)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!items.length) { toast('Semua item antrean sudah punya hasil.'); return; }
    if (!confirm(`Generate ${items.length} video dengan Omni Flash 1.2 secara berurutan? Member membayar NexaBot per video (±Rp 150).`)) return;
    let ok = 0, fail = 0;
    for (let i = 0; i < items.length; i++) {
      const q = items[i];
      q.genStatus = `(${i + 1}/${items.length}) mulai…`;
      persist(); render();
      const success = await aiGenerateVideoForQueueItem(q, null);
      success ? ok++ : fail++;
      persist(); render();
    }
    toast(fail ? `Selesai: ${ok} berhasil, ${fail} gagal — cek item yang bertanda error.` : `Semua ${ok} video selesai & tersimpan.`);
  }

  async function aiGenerateSceneVideo(sceneId, triggerBtn) {
    const p = project(); const s = p?.scenes.find(x => x.id === sceneId); if (!s) return;
    const src = s.video_prompt || s.prompt || s.action;
    if (!src || !String(src).trim()) { toast('Isi aksi / prompt visual adegan dulu.'); return; }
    let q = p.queue.find(x => x.sceneId === sceneId);
    if (!q) {
      q = { id: makeId(), sceneId: s.id, title: s.title || 'Adegan', prompt: String(src).trim(), voiceover: s.voiceover || '', provider: 'NexaBot (Omni Flash 1.2)', ratio: '9:16', resolution: '720p', duration: '15 detik', variations: '1', status: 'ready', result: null, order: p.queue.length, genStatus: '' };
      p.queue.push(q);
      persist(); render();
    }
    if (q.result && q.result.data) { toast('Adegan ini sudah punya video di antrean.'); return; }
    await aiGenerateVideoForQueueItem(q, triggerBtn);
  }

  async function mergeAllVideos() {
    const p = project(); if (!p) return;
    if (opRunning('merge')) return;
    if (!p.queue?.length) { toast('Antrean kosong — belum ada klip yang bisa digabung.'); return; }
    const items = [...p.queue]
      .filter(q => q.result && /^video\//.test(q.result.type || '') && q.result.data)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (items.length < 2) { toast('Butuh minimal 2 video jadi untuk digabung (semua adegan).'); return; }
    const est = items.length * 15;
    if (!confirm(`Gabung ${items.length} klip (±${est} detik) jadi satu MP4?`)) return;
    setRunning('merge', true);
    try {
      const files = [];
      for (let i = 0; i < items.length; i++) {
        setMergeStage(`Mengunduh klip ${i + 1}/${items.length}…`);
        files.push(await fetchRemoteVideoFile(items[i].result.data, `scene_${String(i + 1).padStart(2, '0')}.mp4`));
      }
      setMergeStage('Memuat ffmpeg.wasm…');
      const { ffmpeg, fetchFile } = await loadFfmpeg();
      const stamp = Date.now();
      const names = [];
      for (let i = 0; i < files.length; i++) {
        const name = `m_${stamp}_${i}.mp4`;
        names.push(name);
        await ffmpeg.writeFile(name, await fetchFile(files[i]));
      }
      const listName = `list_${stamp}.txt`;
      await ffmpeg.writeFile(listName, new TextEncoder().encode(names.map(n => `file '${n}'`).join('\n')));
      setMergeStage('Menggabungkan…');
      const outName = `drama_${stamp}.mp4`;
      try {
        await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', listName, '-c', 'copy', outName]);
      } catch {
        // codec/parameter segmen beda → re-encode sekali
        await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', listName, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outName]);
      }
      const out = await ffmpeg.readFile(outName);
      const bytes = typeof out === 'string' ? new TextEncoder().encode(out) : out;
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      const url = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }));
      mergedVideos.set(p.id, { name: `${slugify(p.name)}-drama.mp4`, size: buf.byteLength, url, scenes: items.length, est });
      for (const n of names) await ffmpeg.deleteFile(n).catch(() => {});
      await ffmpeg.deleteFile(listName).catch(() => {});
      await ffmpeg.deleteFile(outName).catch(() => {});
      toast('Video drama selesai digabung — unduh sebelum menutup tab.');
    } catch (e) {
      toast(`Gagal menggabungkan: ${String(e?.message || e).slice(0, 140)}`);
    } finally {
      setRunning('merge', false);
      setMergeStage('');
      persist();
      render();
    }
  }

  function handleDramaAction(action, id) {
    const p = project();
    if (action === 'ai-story') return aiGenerateStory();
    if (action === 'gen-image') {
      const btn = document.querySelector(`[data-drama-action="gen-image"][data-id="${id}"]`);
      return aiGenerateSceneImage(id, btn);
    }
    if (action === 'gen-video') {
      const btn = document.querySelector(`[data-drama-action="gen-video"][data-id="${id}"]`);
      if (btn?.dataset.kind === 'scene') return aiGenerateSceneVideo(id, btn);
      const q = p?.queue.find(x => x.id === id);
      if (q) return aiGenerateVideoForQueueItem(q, btn);
      return aiGenerateSceneVideo(id, btn);
    }
    if (action === 'gen-all') return aiGenerateAllVideos();
    if (action === 'merge-all') return mergeAllVideos();
  }

  let state = {projects:[],current:null,page:'dashboard'};
  try {
    const raw=JSON.parse(localStorage.getItem(KEY)||'null');
    if(raw && Array.isArray(raw.projects)){state.projects=raw.projects;state.current=raw.current;state.page=PAGE_NAMES[raw.page]?raw.page:'dashboard';}
  } catch {}
  if(!state.projects.length){const p=demo();state.projects=[p];state.current=p.id;}
  if(!state.projects.some(p=>p.id===state.current))state.current=state.projects[0]?.id || null;
  const project=()=>state.projects.find(p=>p.id===state.current) || null;
  let toastTimer;
  function toast(text){const el=$('#toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2500);}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({projects:state.projects,current:state.current,page:state.page}));$('#saveLabel').textContent='Tersimpan lokal';}catch(e){$('#saveLabel').textContent='Penyimpanan penuh';toast('Penyimpanan browser hampir penuh. Ekspor proyek lalu hapus lampiran besar.');}}
  function syncProjectLabels(){const p=project();const name=p?.name||'Pilih proyek';$('#topProjectName').textContent=name;$('#sideProjectName').textContent=name;$('#navQueueCount').textContent=p?.queue?.length||0;$('#crumbPage').textContent=PAGE_NAMES[state.page]||'Ringkasan';document.title=`ARKX Drama studio v2 · ${PAGE_NAMES[state.page]||'Ringkasan'}`;}
  function setPage(page){if(!PAGE_NAMES[page])return;state.page=page;$('#sidebar').classList.remove('open');persist();render();}
  function pageHead(kicker,title,desc,actions=''){return `<div class="page-head"><div class="page-head-copy"><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${desc}</p></div><div class="head-actions">${actions}</div></div>`;}
  function badgeStatus(q){if(q.result)return '<span class="pill mint">Hasil dilampirkan</span>';if(q.status==='copied')return '<span class="pill purple">Disalin manual</span>';if(q.status==='ready')return '<span class="pill amber">Siap disalin</span>';return '<span class="pill">Draft</span>';}
  function providerClass(v){return String(v||'').toLowerCase().includes('nexa')?'platform-nexabot':String(v||'').toLowerCase().includes('flow')?'platform-flow':String(v||'').toLowerCase().includes('chat')?'platform-chatgpt':String(v||'').toLowerCase().includes('gemini')?'platform-gemini':'platform-grok';}
  function platformSelect(q){return `<select class="select" data-queue-field="provider" data-id="${esc(q.id)}" aria-label="Provider pilihan">${PROVIDERS.map(x=>`<option ${q.provider===x?'selected':''}>${x}</option>`).join('')}</select>`;}
  function dashboard(){
    const p=project();if(!p)return noProject();
    const total=p.queue.length,ready=p.queue.filter(q=>q.status==='ready'||q.status==='copied'||q.result).length,withResult=p.queue.filter(q=>q.result).length;
    const pct=total?Math.round(ready/total*100):0;
    const recent=p.queue.slice(0,3);
    return `${pageHead('RUANG CERITA · V2','Cerita Anda, siap dirangkai.','Kelola ide, adegan, dan prompt di satu workspace. AI Story (Gemini), Gambar (Nano Banana Pro), dan Video (Omni Flash 1.2 + narasi, digabung ffmpeg) siap generate langsung.',`<button class="button button-quiet" data-page="story">✧ Buka AI Story</button><button class="button button-primary" data-action="add-prompt">＋ Prompt baru</button>`)}
      <section class="dashboard-hero"><div class="hero-copy"><div class="eyebrow"><i></i> RUANG KERJA LOKAL · TERSIMPAN DI BROWSER</div><h1>Bangun cerita.<br><span style="color:#c5a2fd">Rangkai klip.</span></h1><p>Mulai dari premis, susun adegan, lalu siapkan prompt dan urutan klip untuk diproses manual di layanan pilihan Anda.</p></div><div class="hero-quick"><button class="button button-primary" data-page="story">✧ Susun cerita</button><button class="button" data-page="workspace">Buka Story Workspace →</button></div></section>
      <div class="stats-grid"><div class="stat-card"><span class="stat-icon">◈</span><div><b>${state.projects.length}</b><small>Proyek</small></div><span class="stat-trend">aktif</span></div><div class="stat-card"><span class="stat-icon mint">♙</span><div><b>${p.characters.length}</b><small>Karakter</small></div></div><div class="stat-card"><span class="stat-icon amber">▤</span><div><b>${p.scenes.length}</b><small>Adegan</small></div></div><div class="stat-card"><span class="stat-icon lime">☷</span><div><b>${total}</b><small>Prompt queue</small></div></div></div>
      <div class="grid"><section class="panel col-8"><div class="panel-head"><div><h2>Proyek aktif</h2><p>Ruang cerita yang sedang Anda kerjakan.</p></div><button class="panel-link" data-page="storyboard">Buka storyboard →</button></div><div class="project-summary"><img class="cover-thumb" src="assets/drama.webp" alt="Contoh visual drama"/><div class="project-summary-copy"><b>${esc(p.name)}</b><small>${esc(p.description||'Tambahkan sinopsis di pengaturan proyek.')} · ${esc(p.style||'Drama sinematik')}</small></div><span class="pill mint">Lokal</span><button class="outline-button" data-page="story">Kelola</button></div><div class="divider"></div><div class="section-kicker">ALUR CERITA</div><div class="quick-flow" style="margin-top:9px"><div class="flow-step"><span class="step-no">01</span><b>Premis & tokoh</b><small>${p.characters.length} karakter tersimpan</small></div><div class="flow-step"><span class="step-no">02</span><b>Storyboard</b><small>${p.scenes.length} adegan tersusun</small></div><div class="flow-step"><span class="step-no">03</span><b>Prompt queue</b><small>${total} prompt lokal</small></div><div class="flow-step"><span class="step-no">04</span><b>Hasil & klip</b><small>${withResult} file dilampirkan</small></div></div></section>
      <section class="panel col-4"><div class="panel-head"><div><h2>Progres lokal</h2><p>Status yang Anda kelola sendiri.</p></div><span class="pill purple">manual</span></div><div style="display:flex;justify-content:space-between;align-items:end"><div><b style="font-size:26px;letter-spacing:-1px">${pct}%</b><div class="muted small">siap disalin / sudah punya hasil</div></div><span class="badge-number">${ready} / ${total}</span></div><div class="progress-track"><span style="width:${pct}%"></span></div><p class="muted small" style="margin:11px 0 0">Tidak memantau atau mengirim pekerjaan ke penyedia AI.</p></section>
      <section class="panel col-7"><div class="panel-head"><div><h2>Prompt terbaru</h2><p>Siapkan teks untuk Flow, ChatGPT, Gemini, atau Grok.</p></div><button class="panel-link" data-page="queue">Lihat semua →</button></div><div class="queue-preview">${recent.length?recent.map((q,i)=>`<div class="queue-preview-row"><span class="queue-index">${String(i+1).padStart(2,'0')}</span><div class="queue-row-copy"><b>${esc(q.title||'Prompt tanpa judul')}</b><small><i class="platform-dot ${providerClass(q.provider)}"></i>${esc(q.provider||'Google Flow')} · ${esc(q.ratio||'9:16')}</small></div>${badgeStatus(q)}</div>`).join(''):'<div class="empty-state"><b>Belum ada prompt</b>Tambahkan dari storyboard atau mulai prompt baru.</div>'}</div></section>
      <section class="panel col-5"><div class="panel-head"><div><h2>Catatan versi</h2><p>Yang bisa dilakukan sekarang.</p></div><span class="pill mint">AI CONNECTED</span></div><div class="notice"><span class="notice-icon">✧</span><span><strong>Cerita AI (Gemini), gambar referensi (Nano Banana Pro), dan video ber-narasi (Omni Flash 1.2) sudah tersambung.</strong> Generate prompt & adegan dari AI, buat gambar referensi per adegan, dan generate semua video drama satu klik — lalu gabung jadi satu video di Story Workspace.</span></div><div class="divider"></div><div class="small muted">Provider yang bisa dipilih</div><div class="card-actions" style="margin-top:8px">${PROVIDERS.map(x=>`<span class="pill"><i class="platform-dot ${providerClass(x)}"></i>${x}</span>`).join('')}</div></section></div>`;
  }
  function noProject(){return `${pageHead('WORKSPACE','Mulai cerita baru','Buat proyek untuk mengelola karakter, storyboard, dan antrean prompt.',`<button class="button button-primary" data-action="new-project">＋ Proyek baru</button>`)}<section class="panel empty-state"><b>Belum ada proyek aktif</b>Buat proyek baru untuk melanjutkan.</section>`;}
  function storyPage(){
    const p=project();if(!p)return noProject();
    const templates=[['Micro drama · 3 babak','Tiga beat: pemantik, konflik, cliffhanger.'],['Serial vertikal · 5 adegan','Lima beat pendek dengan hook dan akhir episode.'],['Film pendek · 4 adegan','Awal, pemicu, titik balik, resolusi.']];
    return `${pageHead('AI STORY · STORY FACTORY','Bentuk fondasi cerita.','Pilih template, lalu susun kerangka lokal atau langsung generate cerita utuh dengan Gemini AI.',`<button class="button button-quiet" data-page="storyboard">Buka storyboard →</button>`)}
      <div class="grid"><section class="panel col-7"><div class="panel-head"><div><h2>Story factory</h2><p>Kerangka lokal atau generasi penuh dengan Gemini AI — semua bisa diedit.</p></div><span class="pill purple">GEMINI AI</span></div>
      <div class="field"><label>Nama proyek / judul cerita</label><input class="input" data-project-field="name" value="${esc(p.name)}" placeholder="Judul cerita"></div><div class="field"><label>Premis / ide utama</label><textarea class="textarea tall" data-story-field="premise" placeholder="Tokoh utama, tujuan, konflik, dan rahasia cerita...">${esc(p.story?.premise||p.description||'')}</textarea><small class="field-hint">Teks diproses AI hanya saat kamu menekan tombol “Buat dengan AI (Gemini)”. Kerangka lokal sama sekali tidak mengirim apa pun.</small></div>
      <div class="field"><label>Template cerita</label><div class="template-grid">${templates.map(([n,d])=>`<label class="template-option"><input type="radio" name="storyTemplate" data-story-template value="${esc(n)}" ${(p.story?.template||p.template)===n?'checked':''}><span><b>${esc(n)}</b><small>${esc(d)}</small></span></label>`).join('')}</div></div>
      <div class="card-actions"><button class="button button-primary" data-action="build-outline">✧ Buat kerangka lokal</button><button class="button button-primary" data-drama-action="ai-story">✨ Buat dengan AI (Gemini)</button><span class="muted small">Kerangka: <strong>placeholder yang bisa diedit</strong>. AI: cerita + adegan + prompt video utuh.</span></div>
      <div class="divider"></div><div class="field"><label>Deskripsi proyek</label><textarea class="textarea" data-project-field="description" placeholder="Catatan singkat untuk proyek...">${esc(p.description||'')}</textarea></div><div class="form-grid"><div class="field"><label>Gaya visual</label><select class="select" data-project-field="style">${['Drama sinematik','Thriller noir','Romansa hangat','Fantasi urban','Dokumenter realistis','Animasi stylized'].map(x=>`<option ${p.style===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Format cerita</label><select class="select" data-project-field="template">${['Micro drama · 3 babak','Serial vertikal · 5 adegan','Film pendek · 4 adegan','Adegan tunggal','Bebas'].map(x=>`<option ${p.template===x?'selected':''}>${x}</option>`).join('')}</select></div></div>
      </section><section class="panel col-5"><div class="panel-head"><div><h2>Karakter</h2><p>Catatan tokoh untuk menjaga konsistensi cerita.</p></div><span class="badge-number">${p.characters.length} tokoh</span></div><div class="character-list">${p.characters.length?p.characters.map(c=>`<div class="character-row"><span class="character-avatar">${esc((c.name||'?').slice(0,1).toUpperCase())}</span><div class="character-copy"><b>${esc(c.name)}</b><small>${esc(c.description||'Belum ada catatan karakter.')}</small></div><button title="Hapus karakter" data-action="delete-character" data-id="${esc(c.id)}">×</button></div>`).join(''):'<div class="empty-state"><b>Belum ada karakter</b>Tambahkan tokoh di bawah ini.</div>'}</div><div class="divider"></div><div class="field"><label>Nama tokoh</label><input class="input" id="newCharacterName" placeholder="Contoh: Nara"></div><div class="field"><label>Catatan karakter</label><textarea class="textarea" id="newCharacterDescription" placeholder="Motivasi, sifat, penampilan..."></textarea></div><button class="button" data-action="add-character">＋ Tambah karakter</button>
      <div class="divider"></div><div class="notice warning"><span class="notice-icon">ⓘ</span><span>“Kerangka lokal” menyusun placeholder statis (tanpa AI). “Buat dengan AI (Gemini)” mengirim premis ke server → Gemini menyusun judul, sinopsis, karakter &amp; adegan lengkap dengan prompt still &amp; prompt video (EN) — semua bisa diedit sebelum di-generate.</span></div></section></div>`;
  }
  function storyboardPage(){
    const p=project();if(!p)return noProject();
    return `${pageHead('STORYBOARD · ${p.scenes.length} ADEGAN','Susun adegan satu per satu.','Tulis aksi, dialog, prompt visual, dan lampirkan gambar referensi untuk tiap adegan.',`<button class="button button-quiet" data-page="story">Ubah fondasi cerita</button><button class="button button-primary" data-action="add-scene">＋ Tambah adegan</button>`)}
      <section class="panel"><div class="panel-head"><div><h2>${esc(p.name)}</h2><p>${esc(p.description||'Tambahkan sinopsis dari halaman AI Story.')}</p></div><span class="pill">${esc(p.style||'Drama sinematik')}</span></div><div class="storyboard-list">${p.scenes.length?p.scenes.map((s,i)=>`<article class="scene-card"><div class="scene-top"><span class="scene-number">${String(i+1).padStart(2,'0')}</span><input data-scene-field="title" data-id="${esc(s.id)}" value="${esc(s.title||`Adegan ${i+1}`)}" aria-label="Judul adegan"><span class="pill ${s.reference?'mint':''}">${s.reference?'Referensi ada':'Draft'}</span></div><div class="scene-body"><div class="scene-grid"><div class="field"><label>Aksi / visual</label><textarea class="textarea" data-scene-field="action" data-id="${esc(s.id)}" placeholder="Apa yang terlihat dan terjadi?">${esc(s.action)}</textarea></div><div class="field"><label>Dialog / suara</label><textarea class="textarea" data-scene-field="dialogue" data-id="${esc(s.id)}" placeholder="Tokoh: dialog...">${esc(s.dialogue)}</textarea></div><div class="field scene-prompt"><label>Prompt visual · tulis atau tempel manual</label><textarea class="textarea" data-scene-field="prompt" data-id="${esc(s.id)}" placeholder="Komposisi, suasana, pencahayaan, karakter, gaya...">${esc(s.prompt)}</textarea></div><div class="field scene-prompt"><label>Narasi / Voiceover — dibacakan AI di video (Bahasa Indonesia)</label><textarea class="textarea" data-scene-field="voiceover" data-id="${esc(s.id)}" placeholder="Narasi 1 kalimat Bahasa Indonesia (dibaca di video)">${esc(s.voiceover || '')}</textarea></div></div><div class="scene-footer"><div class="card-actions"><label class="outline-button file-button">＋ Gambar referensi<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-reference-for="${esc(s.id)}"></label>${s.reference?`<span class="result-chip"><img src="${esc(s.reference)}" alt="Gambar referensi"> Tersimpan lokal <button class="link-button" data-action="remove-reference" data-id="${esc(s.id)}">Lepas</button></span>`:'<span class="muted small">Maks. 600 KB / gambar</span>'}</div><div class="card-actions"><button class="outline-button" data-action="scene-to-queue" data-id="${esc(s.id)}">Tambahkan ke queue</button><button class="outline-button" data-drama-action="gen-image" data-id="${esc(s.id)}">📷 Nano Banana Pro</button><button class="outline-button" data-drama-action="gen-video" data-kind="scene" data-id="${esc(s.id)}">⚡ Video 15 dtk</button><button class="outline-button danger-button" data-action="delete-scene" data-id="${esc(s.id)}">Hapus</button></div></div></div></article>`).join(''):'<div class="empty-state"><b>Storyboard masih kosong</b>Buat kerangka di AI Story atau tambahkan adegan manual.</div>'}</div><div class="notice warning" style="margin-top:13px"><span class="notice-icon">ⓘ</span><span>Gambar referensi hanya disimpan dan ditampilkan lokal. Tidak dikirim ke provider AI secara otomatis.</span></div></section>`;
  }
  function queueCard(q,i){
    const options=(field,values)=>`<select class="select" data-queue-field="${field}" data-id="${esc(q.id)}">${values.map(v=>`<option ${String(q[field])===String(v)?'selected':''}>${esc(v)}</option>`).join('')}</select>`;
    const statusOptions=[['draft','Draft'],['ready','Siap disalin'],['copied','Disalin manual']];
    const resultThumb=q.result?`<span class="result-chip">${q.result.type?.startsWith('image/')?`<img src="${esc(q.result.data)}" alt="Hasil tersimpan">`:q.result.type?.startsWith('video/')?`<video class="asset-preview" style="width:64px;height:64px;object-fit:cover;border-radius:8px" src="${esc(q.result.data)}" muted preload="metadata"></video>`:'▣'}${esc(q.result.name||'Hasil lokal')}<button class="link-button" data-action="remove-result" data-id="${esc(q.id)}">Hapus</button></span>`:'<span class="result-chip">Belum ada file hasil lokal</span>';
    return `<article class="queue-item"><div class="queue-item-head"><span class="queue-index">${String(i+1).padStart(2,'0')}</span><div class="queue-title-wrap"><input class="queue-title" data-queue-field="title" data-id="${esc(q.id)}" value="${esc(q.title||'Prompt tanpa judul')}" aria-label="Judul prompt"><div class="queue-meta"><i class="platform-dot ${providerClass(q.provider)}"></i><span class="muted small">${esc(q.provider||PROVIDERS[0])}</span> ${badgeStatus(q)}${q.genStatus?` <small class="pill ${q.genStatus==='done'?'mint':String(q.genStatus).startsWith('error')?'':'amber'}">${esc(String(q.genStatus).slice(0,60))}</small>`:''}</div></div><button class="outline-button danger-button" data-action="delete-prompt" data-id="${esc(q.id)}">Hapus</button></div><div class="queue-item-body"><textarea class="textarea queue-text" data-queue-field="prompt" data-id="${esc(q.id)}" placeholder="Tulis atau tempel prompt untuk dipakai manual...">${esc(q.prompt||'')}</textarea><div class="queue-settings"><div class="field"><label>Provider tujuan</label>${platformSelect(q)}</div><div class="field"><label>Rasio</label>${options('ratio',['9:16','16:9','1:1','4:5'])}</div><div class="field"><label>Resolusi tujuan</label>${options('resolution',['720p','1080p','2K','4K'])}</div><div class="field"><label>Durasi</label>${options('duration',['5 detik','8 detik','10 detik','15 detik','30 detik','60 detik'])}</div><div class="field"><label>Variasi</label>${options('variations',['1','2','3','4'])}</div></div><div class="queue-footer"><div class="card-actions"><button class="outline-button" data-action="copy-prompt" data-id="${esc(q.id)}">Salin prompt</button><button class="outline-button" data-drama-action="gen-video" data-kind="queue" data-id="${esc(q.id)}">⚡ Generate</button><select class="select status-select" data-queue-field="status" data-id="${esc(q.id)}" aria-label="Status manual">${statusOptions.map(([v,label])=>`<option value="${v}" ${q.status===v?'selected':''}>${label}</option>`).join('')}</select><label class="outline-button file-button">＋ Lampirkan hasil<input type="file" accept="image/*,video/*" data-result-for="${esc(q.id)}"></label></div>${resultThumb}</div><div class="field-hint" style="margin-top:8px">Status dan setelan dicatat lokal. Tidak ada prompt yang dikirim atau dipantau oleh halaman ini.</div></div></article>`;
  }
  function queuePage(){
    const p=project();if(!p)return noProject();
    const total=p.queue.length,ready=p.queue.filter(q=>q.status==='ready'||q.status==='copied'||q.result).length,results=p.queue.filter(q=>q.result).length;
    return `${pageHead('PROMPT QUEUE · ${total} ITEM','Siapkan prompt untuk layanan pilihan.','Pilih provider, set rasio/durasi, lalu salin prompt — atau langsung klik Generate (Omni Flash 1.2, key NexaBot member).',`<button class="button button-quiet" data-action="export-csv">Ekspor CSV</button><button class="button" data-action="open-import">↑ Impor berkas</button><button class="button button-primary" data-action="add-prompt">＋ Prompt baru</button><button class="button button-primary" data-drama-action="gen-all">⚡ Generate semua (Omni Flash 1.2)</button>`)}
      <div class="grid"><section class="panel col-8"><div class="import-strip"><span>Impor daftar prompt dari <b>TXT, CSV, XLSX</b> · kolom yang dikenali: title/judul, prompt, provider, ratio, resolution, duration, variations.</span><button class="outline-button" data-action="open-import">Pilih berkas</button><span class="muted small" id="importFileName"></span></div><div class="status-overview"><div><b>Status kerja manual</b><small>“Siap disalin” bukan status pekerjaan provider.</small><div class="progress-track"><span style="width:${total?Math.round(ready/total*100):0}%"></span></div></div><span class="status-count">${ready} / ${total}<small style="display:block;text-align:right;color:#8d8396;font-size:8px;font-weight:400">siap · ${results} hasil lokal</small></span></div><div>${p.queue.length?p.queue.map(queueCard).join(''):'<div class="empty-state"><b>Antrean masih kosong</b>Tambah prompt manual atau impor daftar dari berkas.</div>'}</div><div class="notice warning"><span class="notice-icon">ⓘ</span><span>Provider Flow, ChatGPT, Gemini, dan Grok hanya label tujuan. Integrasi akun, pengiriman prompt, status provider, dan generasi AI/video tidak tersedia di versi web ini.</span></div></section>
      <aside class="panel col-4"><div class="panel-head"><div><h2>Setelan default</h2><p>Dipakai untuk prompt baru.</p></div><span class="pill">Lokal</span></div><div class="field"><label>Provider default</label><select class="select" id="defaultProvider">${PROVIDERS.map((x,i)=>`<option ${i===0?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Format default</label><select class="select" id="defaultRatio"><option>9:16</option><option>16:9</option><option>1:1</option><option>4:5</option></select></div><div class="field"><label>Resolusi tujuan</label><select class="select" id="defaultResolution"><option>1080p</option><option>720p</option><option>2K</option><option>4K</option></select></div><div class="field"><label>Durasi default</label><select class="select" id="defaultDuration"><option>8 detik</option><option>5 detik</option><option>10 detik</option><option>15 detik</option><option>30 detik</option><option>60 detik</option></select></div><div class="divider"></div><div class="panel-head"><div><h2>Provider tujuan</h2><p>Setiap prompt dapat memakai tujuan berbeda.</p></div></div><div class="card-actions">${PROVIDERS.map(x=>`<span class="pill"><i class="platform-dot ${providerClass(x)}"></i>${x}</span>`).join('')}</div><div class="divider"></div><button class="button button-quiet" data-action="clear-queue">Kosongkan antrean</button></aside></div>`;
  }
  function workspacePage(){
    const p=project();if(!p)return noProject();
    const qs=[...p.queue].sort((a,b)=>(a.order??0)-(b.order??0));const results=qs.filter(q=>q.result).length;const done=qs.filter(q=>q.status==='copied'||q.result).length;const videosReady=qs.filter(q=>q.result&&/^video\//.test(q.result.type||'')&&q.result.data).length;const mergedInfo=mergedVideos.get(p.id);
    return `${pageHead('STORY WORKSPACE · SUSUN & EKSPOR','Rangkai urutan klip cerita.','Atur prompt/klip, lihat file yang sudah Anda tambahkan, dan ekspor paket proyek untuk langkah berikutnya.',`<button class="button button-quiet" data-action="export-markdown">↓ Ekspor naskah</button><button class="button button-primary" data-action="export-json">↓ Ekspor proyek</button>`)}
      <div class="grid"><section class="panel col-8"><div class="panel-head"><div><h2>${esc(p.name)}</h2><p>Urutan lokal yang bisa disusun ulang sebelum Anda lanjut di editor/provider lain.</p></div><button class="outline-button" data-page="queue">Kelola prompt →</button></div><div class="workspace-summary"><div class="workspace-stat"><b>${qs.length}</b><small>Item dalam urutan</small></div><div class="workspace-stat"><b>${results}</b><small>File hasil dilampirkan</small></div><div class="workspace-stat"><b>${done}</b><small>Disalin / punya hasil</small><div class="progress-track"><span style="width:${qs.length?Math.round(done/qs.length*100):0}%"></span></div></div></div><div class="workspace-list">${qs.length?qs.map((q,i)=>`<article class="workspace-card"><div class="reorder"><button aria-label="Pindah ke atas" data-action="move-up" data-id="${esc(q.id)}">↑</button><button aria-label="Pindah ke bawah" data-action="move-down" data-id="${esc(q.id)}">↓</button></div><div class="workspace-info"><b>${String(i+1).padStart(2,'0')} · ${esc(q.title||'Prompt tanpa judul')}</b><small><i class="platform-dot ${providerClass(q.provider)}"></i>${esc(q.provider||PROVIDERS[0])} · ${esc(q.ratio||'9:16')} · ${esc(q.duration||'8 detik')}</small></div><div class="workspace-asset">${q.result?(q.result.type?.startsWith('image/')?`<img class="asset-preview" src="${esc(q.result.data)}" alt="Hasil">`:q.result.type?.startsWith('video/')?`<video class="asset-preview" src="${esc(q.result.data)}" muted loop playsinline preload="metadata"></video>`:'<span class="asset-preview" style="display:grid;place-items:center">▣</span>'):'<span class="asset-preview" style="display:grid;place-items:center;color:#746a7e">＋</span>'}<span>${q.result?esc(q.result.name||'File hasil lokal'):'Belum ada hasil terlampir'}<br>${badgeStatus(q)}</span></div><div class="workspace-actions"><button class="outline-button" data-action="copy-prompt" data-id="${esc(q.id)}">Salin</button><button class="outline-button" data-action="edit-prompt" data-id="${esc(q.id)}">Edit</button></div></article>`).join(''):'<div class="empty-state"><b>Belum ada klip untuk dirangkai</b>Tambah prompt di antrean agar dapat menyusun urutannya di sini.</div>'}</div></section>
      <aside class="panel col-4"><div class="panel-head"><div><h2>Ekspor & catatan</h2><p>Ambil proyek untuk melanjutkan pekerjaan.</p></div><span class="pill mint">Backup</span></div><div class="notice"><span class="notice-icon">↓</span><span><strong>Ekspor JSON</strong> menyimpan proyek, storyboard, antrean, setelan, dan file hasil lokal yang dilampirkan.</span></div><div class="divider"></div><div class="notice warning"><span class="notice-icon">ⓘ</span><span>Susunan ini bukan timeline video yang dirender. Tidak ada file video final yang dibuat oleh workspace.</span></div><div class="divider"></div><button class="button button-primary" style="width:100%" data-action="export-json">Ekspor backup JSON</button><button class="button" style="width:100%;margin-top:8px" data-action="export-markdown">Ekspor naskah Markdown</button><button class="button button-quiet" style="width:100%;margin-top:8px" data-action="open-import-json">Impor backup JSON</button><div class="divider"></div><div class="panel-head"><div><h2>🎬 Video Drama</h2><p>${videosReady} dari ${qs.length} klip punya hasil.</p></div><span class="pill ${videosReady >= 2 ? 'mint' : ''}">${videosReady >= 2 ? 'SIAP DIGABUNG' : 'MENUNGGU'}</span></div>${mergedInfo ? `<video src="${mergedInfo.url}" controls playsinline style="width:100%;border-radius:12px;background:#000"></video><a class="button button-primary" href="${mergedInfo.url}" download="${esc(mergedInfo.name)}" style="margin-top:8px;width:100%">↓ Unduh ${esc(mergedInfo.name)} (${(mergedInfo.size/1048576).toFixed(1)} MB)</a><p class="muted small" style="margin-top:6px">⏳ Tersimpan sementara di memori browser — unduh sebelum tutup tab.</p>` : `<p class="muted small">Klik <strong>Gabung</strong> setelah semua adegan jadi — klip digabung sesuai urutan di atas.</p>`}<button class="button ${videosReady >= 2 ? 'button-primary' : 'button-quiet'}" data-drama-action="merge-all" style="width:100%;margin-top:8px" ${videosReady >= 2 ? '' : 'disabled'}>${mergeStage || '🎬 Gabung jadi 1 Video (ffmpeg)'}</button><input class="visually-hidden" id="jsonImportInput" type="file" accept="application/json,.json"></aside></div>`;
  }
  function render(){syncProjectLabels();const content=$('#pageContent');content.innerHTML=state.page==='dashboard'?dashboard():state.page==='story'?storyPage():state.page==='storyboard'?storyboardPage():state.page==='queue'?queuePage():workspacePage();document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===state.page));}
  function addPrompt(data={}){const p=project();if(!p)return;const q={id:makeId(),sceneId:'',title:data.title||`Prompt ${String(p.queue.length+1).padStart(2,'0')}`,prompt:data.prompt||'',provider:data.provider||$('#defaultProvider')?.value||PROVIDERS[0],ratio:data.ratio||$('#defaultRatio')?.value||'9:16',resolution:data.resolution||$('#defaultResolution')?.value||'1080p',duration:data.duration||$('#defaultDuration')?.value||'8 detik',variations:String(data.variations||'1'),status:'draft',result:null,order:p.queue.length};p.queue.push(q);state.page='queue';persist();render();toast('Prompt ditambahkan. Isi teksnya lalu salin manual.');}
  function buildOutline(){const p=project();if(!p)return;const premise=$('[data-story-field="premise"]')?.value.trim()||'';if(p.scenes.length&&!confirm('Storyboard sudah berisi adegan. Ganti seluruhnya dengan kerangka baru?'))return;const template=$('[data-story-template]:checked')?.value||p.story?.template||'Micro drama · 3 babak';const title=p.name||'Cerita baru';const n=template.includes('5')?5:template.includes('4')?4:3;const beats=n===5?['Hook pembuka','Pengenalan tokoh','Masalah muncul','Titik balik','Cliffhanger']:n===4?['Pembuka','Pemicu cerita','Titik balik','Resolusi']:['Pemantik','Konflik','Cliffhanger'];p.story={premise,template};p.template=template;if(premise)p.description=premise;p.scenes=beats.map((beat,i)=>({id:makeId(),title:`${String(i+1).padStart(2,'0')} · ${beat}`,action:`${beat}${premise?` — Kembangkan peristiwa yang berhubungan dengan: ${premise}`:''}`,dialogue:'',prompt:'',reference:null}));persist();state.page='storyboard';render();toast(`Kerangka ${n} adegan dibuat dari template lokal.`);}
  function addCharacter(){const p=project();const name=$('#newCharacterName')?.value.trim();if(!p||!name){toast('Isi nama karakter terlebih dahulu.');return;}p.characters.push({id:makeId(),name,description:$('#newCharacterDescription')?.value.trim()||''});persist();render();toast('Karakter ditambahkan.');}
  function addScene(){const p=project();if(!p)return;p.scenes.push({id:makeId(),title:`Adegan ${String(p.scenes.length+1).padStart(2,'0')}`,action:'',dialogue:'',prompt:'',reference:null});persist();render();toast('Adegan ditambahkan.');}
  function sceneToQueue(id){const p=project(),s=p?.scenes.find(x=>x.id===id);if(!s)return;const prompt=[s.action&&`Aksi: ${s.action}`,s.dialogue&&`Dialog: ${s.dialogue}`,s.prompt&&`Arahan visual: ${s.prompt}`].filter(Boolean).join('\n\n');p.queue.push({id:makeId(),sceneId:s.id,title:s.title||'Adegan',prompt,voiceover:s.voiceover||'',provider:PROVIDERS[0],ratio:'9:16',resolution:'1080p',duration:'8 detik',variations:'1',status:'draft',result:null,order:p.queue.length});state.page='queue';persist();render();toast('Adegan disalin sebagai draft antrean.');}
  function download(name,body,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([body],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1200);}
  function projectMarkdown(p){return `# ${p.name}\n\n${p.description||''}\n\n**Gaya:** ${p.style||'—'} · **Template:** ${p.template||'—'}\n\n## Karakter\n${(p.characters||[]).map(c=>`- **${c.name}:** ${c.description||'—'}`).join('\n')||'_Belum ada karakter_'}\n\n## Storyboard\n${(p.scenes||[]).map((s,i)=>`### ${s.title||`Adegan ${i+1}`}\n\n**Aksi:** ${s.action||'—'}\n\n**Dialog:** ${s.dialogue||'—'}\n\n**Prompt visual:** ${s.prompt||'—'}`).join('\n\n')||'_Belum ada adegan_'}\n\n## Prompt queue · draft lokal\n${(p.queue||[]).map(q=>`### ${q.title}\n\nProvider tujuan: ${q.provider||'—'} · ${q.ratio||'—'} · ${q.resolution||'—'} · ${q.duration||'—'}\n\nStatus lokal: ${STATUS[q.status]||'Draft'}\n\n${q.prompt||'_Prompt kosong_'}\n`).join('\n')||'_Kosong_'}\n\n> Prompt dan file hanya disimpan secara lokal. Ekspor ini bukan video final.\n`;}
  function csvEscape(v){const s=String(v??'');return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
  function exportCsv(){const p=project();if(!p)return;const rows=[['title','prompt','provider','ratio','resolution','duration','variations','status'],...p.queue.map(q=>[q.title,q.prompt,q.provider,q.ratio,q.resolution,q.duration,q.variations,q.status])];download(`${slug(p.name)}-prompts.csv`,rows.map(r=>r.map(csvEscape).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('CSV antrean diunduh.');}
  async function copyPrompt(id){const p=project(),q=p?.queue.find(x=>x.id===id);if(!q?.prompt){toast('Isi prompt terlebih dahulu.');return;}try{await navigator.clipboard.writeText(q.prompt);}catch{const t=document.createElement('textarea');t.value=q.prompt;document.body.append(t);t.select();document.execCommand('copy');t.remove();}q.status='copied';persist();render();toast('Prompt disalin. Tempel manual ke provider pilihan Anda.');}
  function parseCSV(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=c;}row.push(cell);if(row.some(x=>x.trim()))rows.push(row);if(!rows.length)return[];const headers=rows.shift().map(x=>x.trim().toLowerCase().replace(/[ _-]+/g,''));return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));}
  function normalizeImportRow(r,i){const norm={};for(const [k,v] of Object.entries(r||{})){const key=String(k).toLowerCase().trim().replace(/[ _-]+/g,'');norm[key]=v;}const val=(...names)=>{for(const n of names)if(norm[n]!==undefined&&norm[n]!==null&&String(norm[n]).trim()!=='')return String(norm[n]).trim();return'';};let prompt=val('prompt','prompttext','description','text','teks');let title=val('title','judul','name','nama');if(!prompt)return null;if(!title)title=`Prompt ${String(i+1).padStart(2,'0')}`;let provider=val('provider','platform','destination','tujuan')||PROVIDERS[0];const valid=PROVIDERS.find(x=>x.toLowerCase()===provider.toLowerCase());return{title,prompt,provider:valid||PROVIDERS[0],ratio:val('ratio','aspectratio','format')||'9:16',resolution:val('resolution','resolusi')||'1080p',duration:val('duration','durasi')||'8 detik',variations:val('variations','variation','count','jumlah')||'1'};}
  async function importPrompts(file){if(!file)return;const ext=file.name.split('.').pop().toLowerCase();let rows=[];try{if(ext==='xlsx'||ext==='xls'){if(!window.XLSX)throw new Error('XLSX belum siap');const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:'array'});rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});}else if(ext==='csv'){rows=parseCSV(await file.text());}else if(ext==='txt'){const blocks=(await file.text()).split(/\n\s*\n/g).map(s=>s.trim()).filter(Boolean);rows=blocks.map((block,i)=>{const lines=block.split(/\r?\n/);let title='';if(lines[0].startsWith('#'))title=lines.shift().replace(/^#+\s*/,'').trim();return{title:title||`Prompt ${String(i+1).padStart(2,'0')}`,prompt:lines.join('\n').trim()||block};});}else throw new Error('Format tidak didukung');const p=project();const items=rows.map(normalizeImportRow).filter(Boolean).slice(0,100);if(!items.length){toast('Tidak menemukan kolom prompt/teks yang berisi isi prompt.');return;}items.forEach((x,i)=>p.queue.push({...x,id:makeId(),sceneId:'',status:'draft',result:null,order:p.queue.length+i}));persist();state.page='queue';render();toast(`${items.length} prompt diimpor dari ${file.name}.`);}catch(e){toast(e.message==='XLSX belum siap'?'Parser XLSX belum siap. Coba lagi sebentar.':'Berkas tidak dapat dibaca; cek format dan kolom prompt.');}}
  function readDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('read'));r.readAsDataURL(file);});}
  async function attachResult(input){const p=project(),q=p?.queue.find(x=>x.id===input.dataset.resultFor),f=input.files?.[0];if(!q||!f)return;if(f.size>2*1024*1024){toast('Lampiran hasil dibatasi 2 MB per file pada versi lokal.');input.value='';return;}try{const data=await readDataURL(f);q.result={name:f.name,type:f.type||'application/octet-stream',data};q.status='copied';persist();render();toast('File hasil dilampirkan lokal.');}catch{toast('File tidak dapat dibaca.');}input.value='';}
  async function attachReference(input){const p=project(),s=p?.scenes.find(x=>x.id===input.dataset.referenceFor),f=input.files?.[0];if(!s||!f)return;if(!f.type.startsWith('image/')){toast('Pilih file gambar.');input.value='';return;}if(f.size>600*1024){toast('Gambar referensi dibatasi 600 KB agar muat di browser.');input.value='';return;}try{s.reference=await readDataURL(f);persist();render();toast('Gambar referensi disimpan lokal.');}catch{toast('Gambar tidak dapat dibaca.');}input.value='';}
  function importJson(file){if(!file)return;const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);const arr=Array.isArray(d)?d:[d];const valid=arr.filter(x=>x&&typeof x.name==='string'&&Array.isArray(x.scenes)&&Array.isArray(x.characters));if(!valid.length)throw 0;valid.forEach(x=>{if(state.projects.some(p=>p.id===x.id))x.id=makeId();x.id=x.id||makeId();x.queue=Array.isArray(x.queue)?x.queue:[];x.story=x.story||{premise:x.description||'',template:x.template||'Micro drama · 3 babak'};state.projects.push(x);});state.current=valid[0].id;state.page='dashboard';persist();render();toast(`${valid.length} proyek diimpor.`);}catch{toast('JSON tidak cocok dengan format proyek ARKX.');}};r.readAsText(file);}
  function handleAction(action,id){const p=project();if(action==='new-project'){const name=prompt('Nama proyek baru:','Cerita baru');if(name===null)return;const x=blankProject(name.trim()||'Cerita baru');state.projects.push(x);state.current=x.id;state.page='story';persist();render();toast('Proyek baru dibuat.');return;}if(action==='switch-project'){if(state.projects.length<2){toast('Buat proyek baru untuk mengganti proyek.');return;}const list=state.projects.map((x,i)=>`${i+1}. ${x.name}`).join('\n');const value=prompt(`Pilih nomor proyek:\n${list}`,'1');const i=Number(value)-1;if(Number.isInteger(i)&&state.projects[i]){state.current=state.projects[i].id;persist();render();toast('Proyek diganti.');}return;}if(action==='add-prompt'){addPrompt();return;}if(action==='build-outline'){buildOutline();return;}if(action==='add-character'){addCharacter();return;}if(action==='add-scene'){addScene();return;}if(action==='open-import'){$('#importInput').click();return;}if(action==='open-import-json'){$('#jsonImportInput').click();return;}if(action==='export-json'){if(p)download(`${slug(p.name)}.json`,JSON.stringify(p,null,2),'application/json');toast('Backup JSON diunduh.');return;}if(action==='export-markdown'){if(p)download(`${slug(p.name)}.md`,projectMarkdown(p),'text/markdown;charset=utf-8');toast('Naskah Markdown diunduh.');return;}if(action==='export-csv'){exportCsv();return;}if(action==='copy-prompt'){copyPrompt(id);return;}if(action==='edit-prompt'){state.page='queue';persist();render();return;}if(action==='scene-to-queue'){sceneToQueue(id);return;}if(action==='delete-prompt'){if(p&&confirm('Hapus prompt ini dari antrean?')){p.queue=p.queue.filter(q=>q.id!==id);persist();render();toast('Prompt dihapus.');}return;}if(action==='delete-scene'){if(p&&confirm('Hapus adegan ini?')){p.scenes=p.scenes.filter(s=>s.id!==id);persist();render();toast('Adegan dihapus.');}return;}if(action==='delete-character'){if(p){p.characters=p.characters.filter(c=>c.id!==id);persist();render();toast('Karakter dihapus.');}return;}if(action==='remove-reference'){const s=p?.scenes.find(x=>x.id===id);if(s){s.reference=null;persist();render();toast('Referensi dilepas.');}return;}if(action==='remove-result'){const q=p?.queue.find(x=>x.id===id);if(q){q.result=null;persist();render();toast('Lampiran hasil dilepas.');}return;}if(action==='clear-queue'){if(p?.queue.length&&confirm('Kosongkan seluruh antrean prompt?')){p.queue=[];persist();render();toast('Antrean dikosongkan.');}return;}if(action==='move-up'||action==='move-down'){if(!p)return;const i=p.queue.findIndex(q=>q.id===id),j=action==='move-up'?i-1:i+1;if(i<0||j<0||j>=p.queue.length)return;[p.queue[i],p.queue[j]]=[p.queue[j],p.queue[i]];p.queue.forEach((q,n)=>q.order=n);persist();render();return;}}
  document.addEventListener('click',e=>{const nav=e.target.closest('[data-page]');if(nav){e.preventDefault();setPage(nav.dataset.page);return;}const action=e.target.closest('[data-action]');if(action){e.preventDefault();handleAction(action.dataset.action,action.dataset.id);return;}const drama=e.target.closest('[data-drama-action]');if(drama){e.preventDefault();handleDramaAction(drama.dataset.dramaAction, drama.dataset.id);return;}});
  document.addEventListener('input',e=>{const el=e.target,p=project();if(!p)return;if(el.dataset.projectField){p[el.dataset.projectField]=el.value;if(el.dataset.projectField==='name'){syncProjectLabels();}persist();return;}if(el.dataset.storyField){p.story=p.story||{};p.story[el.dataset.storyField]=el.value;if(el.dataset.storyField==='premise'){p.description=el.value;}persist();return;}if(el.dataset.sceneField){const s=p.scenes.find(x=>x.id===el.dataset.id);if(s){s[el.dataset.sceneField]=el.value;persist();}return;}if(el.dataset.queueField&&el.tagName==='TEXTAREA'||el.dataset.queueField&&el.tagName==='INPUT'){const q=p.queue.find(x=>x.id===el.dataset.id);if(q){q[el.dataset.queueField]=el.value;persist();}return;}});
  document.addEventListener('change',e=>{const el=e.target,p=project();if(el.matches('[data-story-template]')&&p){p.story=p.story||{};p.story.template=el.value;persist();return;}if(el.dataset.projectField&&p){p[el.dataset.projectField]=el.value;persist();syncProjectLabels();return;}if(el.dataset.sceneField&&p){const s=p.scenes.find(x=>x.id===el.dataset.id);if(s){s[el.dataset.sceneField]=el.value;persist();}return;}if(el.dataset.queueField&&p){const q=p.queue.find(x=>x.id===el.dataset.id);if(q){q[el.dataset.queueField]=el.value;persist();render();}return;}if(el.id==='importInput'){importPrompts(el.files?.[0]);el.value='';return;}if(el.id==='jsonImportInput'){importJson(el.files?.[0]);el.value='';return;}if(el.dataset.resultFor){attachResult(el);return;}if(el.dataset.referenceFor){attachReference(el);return;}});
  $('#projectSwitcher').addEventListener('click',()=>handleAction('switch-project'));
  $('#sideProject').addEventListener('click',()=>handleAction('switch-project'));
  $('#menuToggle').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#sidebar').classList.remove('open');});
  render();
})();
