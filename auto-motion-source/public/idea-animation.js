(() => {
  const $ = (id) => document.getElementById(`amIdea${id}`);
  const root = $('Studio');
  const landing = document.getElementById('landing');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';

  const canvas = $('Canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const audio = $('AudioReplay');
  audio.preload = 'auto';
  const sample = `Gula hadir dalam banyak makanan yang kita konsumsi setiap hari. Di dalam tubuh, gula menjadi bagian dari proses penyediaan energi, tetapi jumlah dan konteksnya tetap penting.
Memahami label makanan, ukuran porsi, dan kebiasaan harian membantu kita membuat pilihan yang lebih sadar. Visual berikut adalah ilustrasi konsep, bukan pengganti saran tenaga kesehatan.`;
  const styleList = [
    { id: 'cinema', name: 'Cinematic', bg: '#080b14', mid: '#171624', a: '#ffb778', b: '#ff643f', ink: '#f8f4f1', sub: '#bcb8c4', font: 'Inter', pattern: 'cinematic-glow' },
    { id: 'editorial', name: 'Editorial', bg: '#f1eadc', mid: '#dbcfbb', a: '#ba4c30', b: '#192b38', ink: '#211b18', sub: '#686054', font: 'Lora', pattern: 'editorial-rules' },
    { id: 'neon', name: 'Neon cyber', bg: '#061410', mid: '#0b2823', a: '#53f4bd', b: '#47a9ff', ink: '#eafff7', sub: '#8bafa3', font: 'Chakra Petch', pattern: 'neon-perspective' },
    { id: 'blueprint', name: 'Blueprint', bg: '#071a31', mid: '#0c2b4d', a: '#82d4ff', b: '#fff1a6', ink: '#eff8ff', sub: '#a2c4dd', font: 'JetBrains Mono', pattern: 'blueprint-grid' },
    { id: 'paper', name: 'Cut-paper', bg: '#271e18', mid: '#3c2b20', a: '#ffc27f', b: '#f26a4d', ink: '#fff3dd', sub: '#d5c0a0', font: 'Quicksand', pattern: 'cut-paper-layers' },
    { id: 'retro', name: 'Retro grain', bg: '#1a0e26', mid: '#3a1640', a: '#ffcf5b', b: '#f56b8b', ink: '#fff2da', sub: '#d6b7c5', font: 'Bebas Neue', pattern: 'retro-scanlines' },
    { id: 'minimal', name: 'Minimal', bg: '#101217', mid: '#1b1e25', a: '#d9e2f1', b: '#96a6c8', ink: '#f7f8fb', sub: '#9ba3b4', font: 'Inter', pattern: 'minimal-lines' },
    { id: 'pop', name: 'Pop collage', bg: '#17122b', mid: '#2d1b43', a: '#ffdd37', b: '#ff5c85', ink: '#fffbea', sub: '#c8bdd5', font: 'Archivo Black', pattern: 'pop-halftone' },
    { id: 'data', name: 'Data lab', bg: '#101d23', mid: '#18313a', a: '#a6e56e', b: '#54d1dc', ink: '#edfcfa', sub: '#9eb9b8', font: 'JetBrains Mono', pattern: 'data-matrix' },
    { id: 'botanical', name: 'Botanical', bg: '#102017', mid: '#1e3829', a: '#d0dd8c', b: '#f3aa71', ink: '#f5f3df', sub: '#afc0a4', font: 'Lora', pattern: 'botanical-leaves' },
    { id: 'luxe', name: 'Luxe gold', bg: '#11100e', mid: '#292219', a: '#e7c47c', b: '#fff0c3', ink: '#fffaf0', sub: '#c1b8a6', font: 'Playfair Display', pattern: 'art-deco-fan' },
    { id: 'playful', name: 'Playful', bg: '#172338', mid: '#243457', a: '#a8edff', b: '#ffa8d6', ink: '#f8fbff', sub: '#b9c9df', font: 'Outfit', pattern: 'playful-bubbles' },
    { id: 'swiss', name: 'Swiss modern', bg: '#f3f0e8', mid: '#e4dccb', a: '#e63d2e', b: '#181818', ink: '#171717', sub: '#5d5d5d', font: 'Inter', pattern: 'swiss-grid' },
    { id: 'vaporwave', name: 'Vaporwave', bg: '#170e3d', mid: '#481d72', a: '#ff77c8', b: '#55dcff', ink: '#fff3ff', sub: '#cba8de', font: 'Bebas Neue', pattern: 'vaporwave-sunset' },
    { id: 'holographic', name: 'Holographic', bg: '#101321', mid: '#242d49', a: '#a5f3ff', b: '#ff91cb', ink: '#f6ffff', sub: '#b2bfd3', font: 'Outfit', pattern: 'holographic-rings' },
    { id: 'ink', name: 'Hand-drawn ink', bg: '#fbf1dc', mid: '#edddb6', a: '#df613d', b: '#365c50', ink: '#28221a', sub: '#685f51', font: 'Permanent Marker', pattern: 'handdrawn-ink' },
    { id: 'cyberpunk', name: 'Cyberpunk noir', bg: '#17001d', mid: '#3a032a', a: '#ff3be6', b: '#47f2ed', ink: '#fff4fd', sub: '#d7a7cd', font: 'Chakra Petch', pattern: 'cyberpunk-glitch' },
    { id: 'brutalist', name: 'Brutalist type', bg: '#e7e5db', mid: '#c7c1b6', a: '#fe482f', b: '#121212', ink: '#101010', sub: '#55514a', font: 'Anton', pattern: 'brutalist-blocks' },
    { id: 'glass', name: 'Glassmorphism', bg: '#101c36', mid: '#21365e', a: '#9ce3ff', b: '#d7a3ff', ink: '#f4f9ff', sub: '#b5c4da', font: 'Inter', pattern: 'glass-panels' },
    { id: 'isometric', name: 'Isometric', bg: '#12243a', mid: '#234360', a: '#ffbe62', b: '#67e0c2', ink: '#eff8ff', sub: '#aac2d2', font: 'Space Grotesk', pattern: 'isometric-grid' },
    { id: 'chalk', name: 'Chalkboard', bg: '#082a25', mid: '#113d34', a: '#ffefb1', b: '#8de1b8', ink: '#f4f4de', sub: '#b8c9b4', font: 'Permanent Marker', pattern: 'chalkboard' },
    { id: 'thermal', name: 'Thermal map', bg: '#170b2e', mid: '#4a125c', a: '#ffef4d', b: '#ff4d5c', ink: '#fff7e7', sub: '#d2b2dc', font: 'Chakra Petch', pattern: 'thermal-contours' },
    { id: 'mosaic', name: 'Mosaic tiles', bg: '#182023', mid: '#30454a', a: '#72e0d1', b: '#ffb45e', ink: '#eff8f4', sub: '#a9bbb9', font: 'Outfit', pattern: 'mosaic-tiles' },
    { id: 'clay', name: 'Clay craft', bg: '#2c1627', mid: '#512b3f', a: '#ffa992', b: '#ffd36a', ink: '#fff4ed', sub: '#d9b9b1', font: 'Quicksand', pattern: 'clay-forms' },
    { id: 'mono', name: 'Monochrome', bg: '#080a0c', mid: '#202326', a: '#f2f1ea', b: '#7b8088', ink: '#f9f8f2', sub: '#a7a9ab', font: 'Inter', pattern: 'monochrome-stripes' },
    { id: 'bauhaus', name: 'Bauhaus', bg: '#fff3d5', mid: '#f1dba8', a: '#dd302f', b: '#15598d', ink: '#171717', sub: '#545049', font: 'Archivo Black', pattern: 'bauhaus-geometry' },
    { id: 'liquid', name: 'Liquid chrome', bg: '#0a1623', mid: '#172c4a', a: '#6cfff0', b: '#a68cff', ink: '#f5fffe', sub: '#a7c4d4', font: 'Outfit', pattern: 'liquid-waves' },
    { id: 'sports', name: 'Sports broadcast', bg: '#071a1b', mid: '#0f4a3f', a: '#baff33', b: '#efffda', ink: '#f2ffe9', sub: '#a6c4b2', font: 'Anton', pattern: 'sports-field' },
    { id: 'science', name: 'Science schematic', bg: '#08192b', mid: '#12324a', a: '#82e7ff', b: '#b9f28f', ink: '#edfaff', sub: '#a6c7d7', font: 'JetBrains Mono', pattern: 'science-network' },
    { id: 'comic', name: 'Comic halftone', bg: '#fae28c', mid: '#f7b856', a: '#e84132', b: '#1d2558', ink: '#171717', sub: '#4e4941', font: 'Bungee', pattern: 'comic-panels' },
    { id: 'glitch', name: 'Digital glitch', bg: '#100d25', mid: '#241b49', a: '#f84d9a', b: '#3df5d7', ink: '#f3f7ff', sub: '#afafd0', font: 'Chakra Petch', pattern: 'digital-glitch' },
  ];
  const paletteById = Object.fromEntries(styleList.map((style) => [style.id, style]));
  // A preset is an art direction, not a palette swap: each gets its own stage geometry,
  // title motion, and label treatment. Fractions keep the layouts responsive to format.
  const ART_DIRECTIONS = Object.freeze({
    cinema: { box: [.085,.20,.83,'left',.085,.44,.83,.32,.79,.85,.075], motion: 'push', tag: 'subtitle' },
    editorial: { box: [.10,.16,.40,'left',.51,.25,.39,.52,.81,.855,.065], motion: 'rise', tag: 'rule' },
    neon: { box: [.08,.14,.84,'center',.08,.39,.84,.36,.77,.845,.08], motion: 'pulse', tag: 'ticker' },
    blueprint: { box: [.10,.21,.80,'left',.18,.43,.64,.30,.78,.86,.07], motion: 'trace', tag: 'outline' },
    paper: { box: [.08,.18,.84,'left',.11,.43,.78,.34,.80,.86,.075], motion: 'stack', tag: 'cutout' },
    retro: { box: [.08,.16,.84,'center',.08,.38,.84,.37,.78,.86,.07], motion: 'flicker', tag: 'tape' },
    minimal: { box: [.12,.18,.72,'left',.23,.39,.67,.36,.81,.88,.055], motion: 'fade', tag: 'underline' },
    pop: { box: [.07,.13,.84,'left',.12,.40,.79,.32,.78,.85,.08], motion: 'bounce', tag: 'sticker' },
    data: { box: [.08,.18,.53,'left',.56,.29,.34,.49,.79,.86,.07], motion: 'ticker', tag: 'terminal' },
    botanical: { box: [.08,.17,.82,'left',.12,.40,.76,.34,.78,.855,.075], motion: 'sway', tag: 'seed' },
    luxe: { box: [.12,.18,.76,'center',.15,.39,.70,.33,.78,.86,.07], motion: 'glide', tag: 'plaque' },
    playful: { box: [.08,.20,.80,'center',.10,.42,.80,.31,.78,.85,.08], motion: 'spring', tag: 'bubble' },
    swiss: { box: [.08,.14,.50,'left',.53,.34,.39,.43,.81,.86,.065], motion: 'snap', tag: 'block' },
    vaporwave: { box: [.08,.13,.84,'center',.12,.36,.76,.42,.80,.865,.07], motion: 'float-up', tag: 'chrome' },
    holographic: { box: [.08,.18,.74,'left',.20,.35,.66,.43,.80,.865,.07], motion: 'orbit', tag: 'glow' },
    ink: { box: [.10,.23,.82,'left',.08,.48,.84,.27,.80,.86,.07], motion: 'wobble', tag: 'hand-note' },
    cyberpunk: { box: [.07,.16,.58,'left',.52,.32,.40,.43,.80,.86,.07], motion: 'jitter', tag: 'signal' },
    brutalist: { box: [.06,.12,.88,'left',.11,.40,.78,.30,.78,.85,.08], motion: 'slam', tag: 'hard' },
    glass: { box: [.09,.18,.82,'center',.09,.40,.82,.34,.80,.85,.08], motion: 'glass', tag: 'frost' },
    isometric: { box: [.08,.16,.62,'left',.44,.28,.48,.48,.80,.86,.065], motion: 'lift', tag: 'tile' },
    chalk: { box: [.09,.18,.78,'left',.14,.38,.72,.39,.80,.86,.07], motion: 'chalk', tag: 'chalk' },
    thermal: { box: [.08,.20,.62,'right',.30,.37,.68,.36,.79,.86,.075], motion: 'breathe', tag: 'contour' },
    mosaic: { box: [.08,.18,.84,'center',.13,.38,.74,.38,.78,.86,.07], motion: 'assemble', tag: 'tile' },
    clay: { box: [.08,.19,.84,'left',.17,.37,.66,.42,.80,.86,.07], motion: 'squish', tag: 'soft' },
    mono: { box: [.08,.13,.72,'left',.19,.40,.73,.32,.79,.87,.06], motion: 'contrast', tag: 'mono' },
    bauhaus: { box: [.08,.16,.72,'left',.28,.37,.65,.39,.80,.86,.07], motion: 'rotate', tag: 'shape' },
    liquid: { box: [.08,.18,.84,'center',.11,.40,.78,.34,.80,.86,.07], motion: 'flow', tag: 'wave' },
    sports: { box: [.08,.16,.50,'left',.53,.32,.39,.43,.80,.86,.08], motion: 'dash', tag: 'score' },
    science: { box: [.07,.18,.53,'left',.56,.30,.35,.48,.80,.86,.07], motion: 'orbit-nodes', tag: 'spec' },
    comic: { box: [.07,.13,.86,'center',.12,.40,.76,.31,.78,.85,.08], motion: 'impact', tag: 'speech' },
    glitch: { box: [.08,.18,.82,'left',.15,.38,.70,.40,.80,.86,.075], motion: 'glitch', tag: 'fragment' },
  });
  const formats = { vertical: [1080, 1920], horizontal: [1920, 1080], square: [1080, 1080] };
  let mode = 'idea';
  let scenes = [];
  let duration = 0;
  let playing = false;
  let startedAt = 0;
  let frozenAt = 0;
  let raf = 0;
  let toastTimer = 0;
  let activeScene = -1;
  let sceneButtons = [];
  let exporting = false;
  let voiceFile = null;
  let voiceBuffer = null;
  let voiceObjectUrl = '';
  let voiceAudioContext = null;
  let exportAudioContext = null;
  let exportAudioSource = null;
  let exportAudioStream = null;
  let exportVideoStream = null;
  let exportRecorder = null;
  let ttsBusy = false;

  function showToast(message) {
    const toast = $('Toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3400);
  }

  function initStyleGrid() {
    const grid = $('StyleGrid');
    const styleSelect = $('Style');
    grid.replaceChildren();
    styleSelect.replaceChildren();
    $('StyleCount').textContent = `${styleList.length} gaya`;
    grid.setAttribute('aria-label', `${styleList.length} preset gaya visual`);
    for (const style of styleList) {
      const option = document.createElement('option');
      option.value = style.id;
      option.textContent = style.name;
      styleSelect.append(option);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'am-style-choice';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(style.id === $('Style').value));
      button.setAttribute('aria-label', `${style.name} art direction`);
      button.dataset.style = style.id;
      const swatch = document.createElement('i');
      swatch.className = 'am-style-swatch';
      swatch.style.setProperty('--swatch', `linear-gradient(135deg,${style.bg},${style.mid})`);
      swatch.style.setProperty('--swa', style.a);
      swatch.style.setProperty('--swb', style.b);
      const label = document.createElement('span');
      label.textContent = style.name;
      button.append(swatch, label);
      button.addEventListener('click', () => {
        $('Style').value = style.id;
        syncStyleButtons();
        drawFrame(currentTime());
      });
      grid.append(button);
    }
  }

  function syncStyleButtons() {
    document.querySelectorAll('.am-style-choice').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.style === $('Style').value));
    });
  }

  function splitText(text) { return window.AutoMotionNarrative.splitText(text); }

  function focusWords(text) { return window.AutoMotionNarrative.focusWords(text); }

  function buildScenes(text) {
    return window.AutoMotionNarrative.buildScenes(text, $('Pace').value);
  }

  function alignScenesToVoice() {
    duration = window.AutoMotionNarrative.syncTimings(scenes, voiceBuffer?.duration || 0);
  }

  function totalDuration() {
    return scenes.reduce((sum, scene) => sum + scene.duration, 0);
  }

  function wrapLines(text, maxWidth, font) {
    ctx.font = font;
    const lines = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  }

  function roundRect(context, x, y, width, height, radius) {
    context.beginPath();
    if (context.roundRect) context.roundRect(x, y, width, height, radius);
    else {
      const r = Math.min(radius, width / 2, height / 2);
      context.moveTo(x + r, y);
      context.arcTo(x + width, y, x + width, y + height, r);
      context.arcTo(x + width, y + height, x, y + height, r);
      context.arcTo(x, y + height, x, y, r);
      context.arcTo(x, y, x + width, y, r);
      context.closePath();
    }
  }

  function ease(value) {
    const p = Math.max(0, Math.min(1, value));
    return 1 - Math.pow(1 - p, 3);
  }

  function sceneAt(time) {
    let elapsed = 0;
    for (let index = 0; index < scenes.length; index += 1) {
      if (time < elapsed + scenes[index].duration) return { index, local: Math.max(0, time - elapsed), elapsed };
      elapsed += scenes[index].duration;
    }
    const last = Math.max(0, scenes.length - 1);
    return { index: last, local: scenes.length ? scenes[last].duration : 0, elapsed: Math.max(0, duration - (scenes[last]?.duration || 0)) };
  }

  function formatTime(time) {
    const seconds = Math.max(0, Math.floor(time));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function updateSeek(time) {
    $('CurrentTime').textContent = formatTime(time);
    $('TotalTime').textContent = formatTime(Math.ceil(duration));
    $('SeekFill').style.width = `${duration ? Math.min(100, 100 * time / duration) : 0}%`;
  }

  function setActiveScene(index, progress = 0) {
    if (activeScene !== index) {
      activeScene = index;
      sceneButtons.forEach((button, buttonIndex) => button.classList.toggle('active', buttonIndex === index));
    }
    const button = sceneButtons[index];
    if (button) button.style.setProperty('--progress', String(Math.max(0.05, Math.min(1, progress))));
  }

  function drawBackground(style, time, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, style.bg);
    gradient.addColorStop(0.58, style.mid);
    gradient.addColorStop(1, style.bg);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    const drift = Math.sin(time * 0.65) * width * 0.055;
    const glow = ctx.createRadialGradient(width * .76 + drift, height * .25, 4, width * .76 + drift, height * .25, width * .6);
    glow.addColorStop(0, `${style.b}32`);
    glow.addColorStop(1, `${style.b}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    drawArtPattern(style, time, width, height);
  }

  function drawArtPattern(style, time, width, height) {
    const s = width / 1080;
    const step = Math.max(32 * s, width * .055);
    const line = (x1, y1, x2, y2, color = style.a, weight = 1) => { ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, weight * s); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const circle = (x, y, r, color = style.a, fill = false) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.strokeStyle = color; fill ? ctx.fill() : ctx.stroke(); };
    ctx.save();
    ctx.globalAlpha = .11;
    switch (style.pattern) {
      case 'cinematic-glow': for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.ellipse(width * (.77 + Math.sin(time * .12) * .025), height * .23, width * (.09 + i * .047), height * (.045 + i * .025), -.22, 0, Math.PI * 2); ctx.strokeStyle = i % 2 ? style.b : style.a; ctx.lineWidth = 2 * s; ctx.stroke(); } break;
      case 'editorial-rules': for (let i = 0; i < 11; i++) line(width * .04, height * (.12 + i * .078) + Math.sin(time * .18 + i) * height * .003, width * .96, height * (.12 + i * .078), i % 3 ? style.a : style.b); break;
      case 'neon-perspective': { const vx = width * .5, vy = height * .48; for (let i = -8; i <= 8; i++) line(vx + i * width * .02, vy, vx + i * width * .19, height, style.a, 1.5); for (let i = 1; i <= 8; i++) { const y = vy + (height - vy) * Math.pow(i / 8, 1.7); line(0, y, width, y, style.b); } break; }
      case 'blueprint-grid': for (let x = 0; x < width; x += step) line(x, 0, x, height, style.a, x % (step * 4) < 1 ? 1.8 : .7); for (let y = 0; y < height; y += step) line(0, y, width, y, style.a, y % (step * 4) < 1 ? 1.8 : .7); for (let i = 0; i < 8; i++) line(width * (.12 + i * .11), height * .16, width * (.12 + i * .11), height * .19, style.b, 2); break;
      case 'cut-paper-layers': for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? style.b : style.a; ctx.beginPath(); ctx.moveTo(width * (.68 + i * .035), height * .1); ctx.lineTo(width * (.96 - i * .02), height * (.18 + i * .11)); ctx.lineTo(width * (.84 + i * .025), height * (.34 + i * .07)); ctx.lineTo(width * (.61 + i * .018), height * (.25 + i * .04)); ctx.closePath(); ctx.fill(); } break;
      case 'retro-scanlines': for (let y = 0; y < height; y += Math.max(8 * s, 10)) line(0, y + Math.sin(time + y) * 2 * s, width, y, y % 4 ? style.a : style.b); ctx.fillStyle = style.a; ctx.beginPath(); ctx.ellipse(width * .76, height * .32, width * .2, height * .09, 0, 0, Math.PI * 2); ctx.fill(); break;
      case 'minimal-lines': for (let i = 0; i < 6; i++) line(width * (.1 + i * .08) + Math.sin(time * .12 + i) * 20 * s, height * .08, width * (.42 + i * .08), height * .92, i % 2 ? style.a : style.b, i === 2 ? 2 : 1); break;
      case 'pop-halftone': for (let y = height * .08; y < height * .64; y += step * .72) for (let x = width * .58; x < width * .97; x += step * .72) circle(x, y, (2 + ((Math.floor(x / step) + Math.floor(y / step)) % 4)) * s, (x + y) % 2 ? style.a : style.b, true); break;
      case 'data-matrix': for (let col = 0; col < 20; col++) for (let row = 0; row < 9; row++) { const x = width * .08 + col * width * .045, y = (row * step * 1.4 + time * (20 + col % 4 * 5)) % height; ctx.fillStyle = row % 3 ? style.a : style.b; ctx.fillRect(x, y, Math.max(2, width * .004), step * (.15 + row % 3 * .1)); } break;
      case 'botanical-leaves': for (let i = 0; i < 8; i++) { const x = width * (.12 + i * .1), y = height * (.86 - i % 3 * .17); ctx.save(); ctx.translate(x, y); ctx.rotate(-.7 + Math.sin(time * .22 + i) * .06); ctx.beginPath(); ctx.ellipse(0, 0, width * .035, height * .085, 0, 0, Math.PI * 2); ctx.strokeStyle = i % 2 ? style.b : style.a; ctx.lineWidth = 2 * s; ctx.stroke(); line(-width * .03, 0, width * .03, 0, style.a); ctx.restore(); } break;
      case 'art-deco-fan': for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.arc(width * .5, height * .46, width * (.12 + i * .035), Math.PI * (1.05 + i * .006), Math.PI * (1.95 - i * .006)); ctx.strokeStyle = i % 3 ? style.a : style.b; ctx.lineWidth = 2 * s; ctx.stroke(); } break;
      case 'playful-bubbles': for (let i = 0; i < 17; i++) { const x = (i * 197 + Math.sin(time * .45 + i) * 30) % width, y = (i * 311 - time * (8 + i % 3 * 3) + height * 2) % height; circle(x, y, width * (.01 + i % 4 * .005), i % 2 ? style.a : style.b, i % 4 === 0); } break;
      case 'swiss-grid': for (let i = 1; i < 8; i++) line(width * i / 8, 0, width * i / 8, height, style.b, i % 2 ? .7 : 1.4); ctx.fillStyle = style.a; ctx.fillRect(width * .73, height * .11, width * .19, height * .16); ctx.fillStyle = style.b; ctx.fillRect(width * .07, height * .71, width * .12, height * .1); break;
      case 'vaporwave-sunset': { const cx = width * .5, cy = height * .38, r = width * .23; circle(cx, cy, r, style.a); for (let i = 0; i < 8; i++) line(cx - r, cy + i * height * .018, cx + r, cy + i * height * .018, style.b, 3); for (let i = -6; i <= 6; i++) line(cx, cy + r * .65, cx + i * width * .15, height, style.a, 1.5); break; }
      case 'holographic-rings': for (let i = 0; i < 9; i++) { ctx.save(); ctx.translate(width * .72, height * .36); ctx.rotate(time * .12 + i * .07); ctx.strokeStyle = i % 2 ? style.a : style.b; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.ellipse(0, 0, width * (.08 + i * .025), height * (.06 + i * .017), .35, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); } break;
      case 'handdrawn-ink': for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(width * .05, height * (.14 + i * .085)); for (let n = 1; n <= 12; n++) ctx.lineTo(width * (.05 + n * .075), height * (.14 + i * .085) + Math.sin(n * 2 + i + time * .3) * height * .008); ctx.strokeStyle = i % 2 ? style.a : style.b; ctx.lineWidth = (1 + i % 3) * s; ctx.stroke(); } break;
      case 'cyberpunk-glitch': for (let i = 0; i < 18; i++) { const y = (i * height / 18 + Math.sin(time * 2 + i) * height * .012) % height, x = ((i * 71 + Math.floor(time * 14) * (i % 3)) % 100) / 100 * width; ctx.fillStyle = i % 2 ? style.a : style.b; ctx.fillRect(x, y, width * (.08 + i % 4 * .025), Math.max(2, height * .003)); } break;
      case 'brutalist-blocks': ctx.fillStyle = style.b; ctx.fillRect(width * .71, height * .08, width * .23, height * .21); ctx.fillStyle = style.a; ctx.fillRect(width * .05, height * .7, width * .14, height * .16); ctx.fillStyle = style.b; ctx.fillRect(width * .22, height * .72, width * .4, height * .025); break;
      case 'glass-panels': for (let i = 0; i < 5; i++) { const x = width * (.12 + i * .15) + Math.sin(time * .25 + i) * width * .012, y = height * (.15 + i % 2 * .23); ctx.fillStyle = i % 2 ? `${style.a}18` : `${style.b}18`; roundRect(ctx, x, y, width * .2, height * .15, width * .025); ctx.fill(); ctx.strokeStyle = `${style.a}7a`; ctx.lineWidth = 2 * s; ctx.stroke(); } break;
      case 'isometric-grid': for (let x = -width; x < width * 2; x += step * 1.2) { line(x, 0, x + height * .52, height, style.a); line(x, height, x + height * .52, 0, style.b); } for (let y = height * .12; y < height; y += step * 1.35) line(0, y, width, y, style.a, .6); break;
      case 'chalkboard': ctx.setLineDash([step * .22, step * .15]); for (let i = 0; i < 7; i++) line(width * .08, height * (.18 + i * .11), width * (.76 + i % 2 * .15), height * (.18 + i * .11) + Math.sin(i) * 6 * s, i % 2 ? style.a : style.b, 2); ctx.setLineDash([]); circle(width * .82, height * .72, width * .08, style.a); break;
      case 'thermal-contours': for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.ellipse(width * (.72 + Math.sin(time * .18) * .025), height * (.33 + i * .006), width * (.09 + i * .025), height * (.035 + i * .017), -.28, 0, Math.PI * 2); ctx.strokeStyle = i % 2 ? style.a : style.b; ctx.lineWidth = 2 * s; ctx.stroke(); } break;
      case 'mosaic-tiles': for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) if ((row * 3 + col * 5) % 4 === 0) { ctx.fillStyle = (row + col) % 2 ? `${style.a}88` : `${style.b}88`; ctx.fillRect(col * width / 9 + 2 * s, row * height / 10 + 2 * s, width / 9 - 4 * s, height / 10 - 4 * s); } break;
      case 'clay-forms': for (let i = 0; i < 6; i++) { const x = width * (.17 + i * .13), y = height * (.68 + Math.sin(time * .35 + i) * .035); ctx.fillStyle = i % 2 ? `${style.a}50` : `${style.b}50`; ctx.beginPath(); ctx.ellipse(x, y, width * .06, height * .035, (i - 2) * .12, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = `${style.ink}18`; ctx.beginPath(); ctx.ellipse(x, y + height * .045, width * .06, height * .016, 0, 0, Math.PI * 2); ctx.fill(); } break;
      case 'monochrome-stripes': for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? `${style.a}24` : `${style.b}30`; ctx.fillRect(i * width / 8, 0, width / 16, height); } for (let y = 0; y < height; y += step * 2) line(0, y, width, y, style.a, .5); break;
      case 'bauhaus-geometry': circle(width * .78, height * .22, width * .14, style.a, true); ctx.fillStyle = style.b; ctx.fillRect(width * .08, height * .65, width * .22, height * .22); ctx.fillStyle = style.a; ctx.beginPath(); ctx.moveTo(width * .54, height * .83); ctx.lineTo(width * .7, height * .52); ctx.lineTo(width * .86, height * .83); ctx.closePath(); ctx.fill(); break;
      case 'liquid-waves': for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(0, height * (.2 + i * .085)); for (let x = 0; x <= width; x += width / 18) ctx.lineTo(x, height * (.2 + i * .085) + Math.sin(x / width * 8 + time * .55 + i * .5) * height * .025); ctx.strokeStyle = i % 2 ? style.a : style.b; ctx.lineWidth = 2 * s; ctx.stroke(); } break;
      case 'sports-field': ctx.setLineDash([step * .25, step * .2]); for (let i = 0; i < 8; i++) line(width * .07, height * (.14 + i * .1), width * .93, height * (.14 + i * .1), style.a); ctx.setLineDash([]); circle(width * .5, height * .52, width * .18, style.b); ctx.strokeRect(width * .08, height * .19, width * .84, height * .64); ctx.fillStyle = style.a; ctx.fillRect(width * .72, height * .1, width * .2, height * .055); break;
      case 'science-network': { const nodes = Array.from({ length: 12 }, (_, i) => ({ x: width * (.12 + ((i * 37) % 76) / 100), y: height * (.14 + ((i * 53) % 70) / 100) })); nodes.forEach((node, i) => { const other = nodes[(i + 3) % nodes.length]; line(node.x, node.y, other.x, other.y, i % 2 ? style.a : style.b); circle(node.x, node.y, width * .009, i % 2 ? style.a : style.b, true); }); break; }
      case 'comic-panels': for (let y = height * .08; y < height * .6; y += step * .42) for (let x = width * .58; x < width; x += step * .42) circle(x, y, width * .0025, style.b, true); ctx.strokeStyle = style.a; ctx.lineWidth = width * .012; ctx.strokeRect(width * .62, height * .12, width * .27, height * .2); line(width * .64, height * .39, width * .95, height * .3, style.a, 5); break;
      case 'digital-glitch': for (let i = 0; i < 25; i++) { const y = (i * height / 25 + Math.sin(time * 3 + i) * height * .01) % height, x = (i * 97 + Math.floor(time * 20) * (i % 4 + 1)) % width; ctx.fillStyle = i % 2 ? `${style.a}aa` : `${style.b}aa`; ctx.fillRect(x, y, width * (.04 + i % 5 * .018), Math.max(2, height * .004)); } break;
      default: for (let x = 0; x < width; x += step) line(x, 0, x, height, style.a, .7); for (let y = 0; y < height; y += step) line(0, y, width, y, style.a, .7);
    }
    ctx.restore();
  }

  function drawDirectionMotif(style, scene, time, width, height, progress) {
    const s = width / 1080;
    const line = (x1, y1, x2, y2, color = style.a, weight = 2) => { ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, weight * s); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const circle = (x, y, r, color = style.a, fill = false) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.strokeStyle = color; fill ? ctx.fill() : ctx.stroke(); };
    const panel = (x, y, w, h, color = style.a, radius = 0) => { ctx.fillStyle = color; if (radius) roundRect(ctx, x, y, w, h, radius); else ctx.beginPath(), ctx.rect(x, y, w, h); ctx.fill(); };
    ctx.save();
    ctx.globalAlpha = .34;
    switch (style.id) {
      case 'cinema': panel(0, 0, width, height * .055, '#000000'); panel(0, height * .945, width, height * .055, '#000000'); for (let i = 0; i < 3; i++) circle(width * .84, height * .30, width * (.14 + i * .035), i % 2 ? style.b : style.a); break;
      case 'editorial': panel(width * .465, height * .11, width * .0015, height * .73, style.b); for (let i = 0; i < 5; i++) line(width * .10, height * (.70 + i * .025), width * (.34 + (i % 2) * .06), height * (.70 + i * .025), i ? style.a : style.b, .8); break;
      case 'neon': { const y = height * .66; line(0, y, width, y, style.a, 3); for (let i = -5; i <= 5; i++) line(width * .5, y, width * (.5 + i * .18), height, style.b, 1.2); for (let i = 1; i <= 5; i++) line(0, y + i * i * height * .012, width, y + i * i * height * .012, style.a, 1); break; }
      case 'blueprint': for (const [x, y, dx, dy] of [[.08,.13,1,1],[.92,.13,-1,1],[.08,.87,1,-1],[.92,.87,-1,-1]]) { line(width*x,height*y,width*(x+dx*.035),height*y,style.a,2); line(width*x,height*y,width*x,height*(y+dy*.025),style.a,2); } for (let i = 0; i < 12; i++) line(width * (.15 + i * .06), height * .36, width * (.15 + i * .06), height * (.36 + (i % 3) * .012), style.b, 1); break;
      case 'paper': for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? `${style.b}75` : `${style.a}75`; ctx.beginPath(); ctx.moveTo(width*(.69+i*.018),height*(.17+i*.035)); ctx.lineTo(width*(.96-i*.018),height*(.12+i*.09)); ctx.lineTo(width*(.89-i*.012),height*(.32+i*.06)); ctx.lineTo(width*(.65+i*.02),height*(.29+i*.04)); ctx.closePath(); ctx.fill(); } break;
      case 'retro': panel(width * .04, height * .08, width * .92, height * .83, `${style.a}22`, width * .018); for (let i = 0; i < 6; i++) line(width * .07, height * (.76 + i * .018), width * .32, height * (.76 + i * .018), i % 2 ? style.a : style.b, 1); break;
      case 'minimal': line(width * .83, height * .12, width * .83, height * .88, style.a, .8); circle(width * .83, height * .12, width * .006, style.b, true); break;
      case 'pop': { const cx = width * .84, cy = height * .28; ctx.beginPath(); for (let i = 0; i < 20; i++) { const a = i * Math.PI / 10, r = width * (i % 2 ? .075 : .12); const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.fillStyle = `${style.a}99`; ctx.fill(); circle(cx, cy, width * .027, style.b, true); break; }
      case 'data': for (let i = 0; i < 3; i++) { ctx.strokeStyle = `${style.a}aa`; ctx.lineWidth = 1.5 * s; roundRect(ctx, width * (.57 + i * .11), height * (.24 + (i % 2) * .06), width * .095, height * .09, width * .008); ctx.stroke(); } for (let i = 0; i < 7; i++) circle(width * (.60 + i * .038), height * .42, width * .003, i % 2 ? style.a : style.b, true); break;
      case 'botanical': for (let side of [0, 1]) for (let i = 0; i < 6; i++) { const x = width * (side ? .94 : .06), y = height * (.2 + i * .095); line(x, y + height * .05, x + (side ? -1 : 1) * width * .035, y, style.a, 1.5); ctx.save(); ctx.translate(x + (side ? -1 : 1) * width * .02, y + height * .02); ctx.rotate(side ? .6 : -.6); ctx.beginPath(); ctx.ellipse(0, 0, width * .014, height * .028, 0, 0, Math.PI * 2); ctx.strokeStyle = style.b; ctx.stroke(); ctx.restore(); } break;
      case 'luxe': for (let i = 0; i < 3; i++) { ctx.strokeStyle = `${style.a}b0`; ctx.lineWidth = (1 + i * .55) * s; ctx.strokeRect(width * (.07 + i * .012), height * (.09 + i * .012), width * (.86 - i * .024), height * (.82 - i * .024)); } for (let x of [.16,.84]) { line(width*x,height*.16,width*.5,height*.21,style.a,1); line(width*.5,height*.21,width*x,height*.16+height*.06,style.a,1); } break;
      case 'playful': for (let i = 0; i < 8; i++) { const x = width * (.08 + ((i * 31) % 84) / 100), y = height * (.22 + ((i * 23) % 55) / 100) + Math.sin(time * 1.2 + i) * height * .008; circle(x, y, width * (.008 + i % 3 * .004), i % 2 ? style.a : style.b, i % 4 === 0); } break;
      case 'swiss': panel(width * .74, height * .12, width * .18, height * .17, `${style.a}aa`); panel(width * .09, height * .70, width * .11, height * .10, `${style.b}bb`); line(width * .09, height * .84, width * .91, height * .84, style.b, .8); break;
      case 'vaporwave': { const cx = width * .5, cy = height * .31, r = width * .15; circle(cx, cy, r, style.a); for (let i = 1; i < 6; i++) line(cx - r, cy + i * height * .018, cx + r, cy + i * height * .018, style.b, 2); const horizon = height * .67; for (let i = -6; i <= 6; i++) line(cx, horizon, cx + i * width * .15, height, style.a, 1); for (let i = 0; i < 5; i++) line(0, horizon + i * i * height * .012, width, horizon + i * i * height * .012, style.b, 1); break; }
      case 'holographic': for (let i = 0; i < 4; i++) { ctx.save(); ctx.translate(width * .83, height * .29); ctx.rotate(time * .12 + i * .4); ctx.beginPath(); ctx.ellipse(0, 0, width * (.07 + i * .018), height * (.04 + i * .015), .35, 0, Math.PI * 2); ctx.strokeStyle = i % 2 ? style.a : style.b; ctx.lineWidth = 1.6 * s; ctx.stroke(); ctx.restore(); } break;
      case 'ink': for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(width * .12, height * (.77 + i * .018)); for (let x = 1; x <= 16; x++) ctx.lineTo(width * (.12 + x * .047), height * (.77 + i * .018) + Math.sin(x * 1.7 + i + time * .2) * height * .003); ctx.strokeStyle = i % 2 ? style.a : style.b; ctx.lineWidth = (1 + i % 2) * s; ctx.stroke(); } break;
      case 'cyberpunk': for (let i = 0; i < 7; i++) { const x = width * (.07 + ((i * 19 + Math.floor(time * 10)) % 85) / 100), y = height * (.22 + i * .08); panel(x, y, width * (.12 + i % 3 * .03), height * .009, i % 2 ? style.a : style.b); } break;
      case 'brutalist': panel(width * .72, height * .09, width * .20, height * .19, style.b); panel(width * .08, height * .72, width * .15, height * .12, style.a); panel(width * .27, height * .75, width * .40, height * .028, style.b); break;
      case 'glass': for (let i = 0; i < 3; i++) { const x = width * (.62 + i * .08), y = height * (.17 + i * .18); panel(x, y, width * .23, height * .12, `${i % 2 ? style.a : style.b}24`, width * .018); ctx.strokeStyle = `${style.ink}66`; ctx.lineWidth = 1 * s; roundRect(ctx, x, y, width * .23, height * .12, width * .018); ctx.stroke(); } break;
      case 'isometric': for (let i = -4; i <= 4; i++) { const x = width * (.5 + i * .09), y = height * .36; ctx.beginPath(); ctx.moveTo(x, y - height * .055); ctx.lineTo(x + width * .07, y); ctx.lineTo(x, y + height * .055); ctx.lineTo(x - width * .07, y); ctx.closePath(); ctx.strokeStyle = i % 2 ? style.a : style.b; ctx.lineWidth = 1.4 * s; ctx.stroke(); } break;
      case 'chalk': ctx.setLineDash([width * .012, width * .009]); ctx.strokeStyle = `${style.a}bb`; ctx.lineWidth = 2 * s; ctx.strokeRect(width * .08, height * .10, width * .84, height * .78); ctx.setLineDash([]); for (let i = 0; i < 3; i++) circle(width * (.17 + i * .055), height * .22, width * .012, style.b); break;
      case 'thermal': for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.ellipse(width * (.78 + Math.sin(time * .25) * .015), height * .34, width * (.09 + i * .022), height * (.045 + i * .012), -.28, 0, Math.PI * 2); ctx.strokeStyle = i % 2 ? style.a : style.b; ctx.lineWidth = 1.5 * s; ctx.stroke(); } break;
      case 'mosaic': for (let row = 0; row < 5; row++) for (let col = 0; col < 7; col++) if ((row * 3 + col * 5) % 3 === 0) panel(width * (.67 + col * .038), height * (.22 + row * .055), width * .032, height * .047, `${(row + col) % 2 ? style.a : style.b}85`); break;
      case 'clay': for (let i = 0; i < 5; i++) { ctx.save(); ctx.shadowColor = '#00000088'; ctx.shadowBlur = 12 * s; ctx.fillStyle = `${i % 2 ? style.a : style.b}99`; ctx.beginPath(); ctx.ellipse(width * (.70 + i * .055), height * (.70 - i % 2 * .05), width * .045, height * .024, i * .2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); } break;
      case 'mono': panel(0, 0, width * .055, height, style.b); for (let i = 0; i < 6; i++) panel(width * (.76 + i * .025), height * .14, width * .012, height * .70, i % 2 ? style.a : style.b); break;
      case 'bauhaus': circle(width * .84, height * .20, width * .08, style.a, true); panel(width * .08, height * .72, width * .12, height * .11, style.b); ctx.fillStyle = style.a; ctx.beginPath(); ctx.moveTo(width * .79, height * .78); ctx.lineTo(width * .87, height * .60); ctx.lineTo(width * .95, height * .78); ctx.closePath(); ctx.fill(); break;
      case 'liquid': for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, height * (.69 + i * .035)); for (let x = 0; x <= 20; x++) ctx.lineTo(width * x / 20, height * (.69 + i * .035) + Math.sin(x * .55 + time * .5 + i) * height * .014); ctx.strokeStyle = i % 2 ? style.a : style.b; ctx.lineWidth = 1.4 * s; ctx.stroke(); } break;
      case 'sports': ctx.strokeStyle = `${style.a}aa`; ctx.lineWidth = 2 * s; ctx.strokeRect(width * .07, height * .12, width * .86, height * .70); ctx.beginPath(); ctx.ellipse(width * .5, height * .47, width * .15, height * .10, 0, 0, Math.PI * 2); ctx.stroke(); line(width * .5, height * .12, width * .5, height * .82, style.a, 1.5); panel(width * .68, height * .10, width * .24, height * .052, `${style.a}88`); break;
      case 'science': { const cx = width * .79, cy = height * .42; for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(i * Math.PI / 3 + time * .1); ctx.beginPath(); ctx.ellipse(0, 0, width * .10, height * .035, 0, 0, Math.PI * 2); ctx.strokeStyle = i % 2 ? style.a : style.b; ctx.stroke(); circle(width * .10, 0, width * .006, style.a, true); ctx.restore(); } circle(cx, cy, width * .012, style.b, true); break; }
      case 'comic': ctx.strokeStyle = style.b; ctx.lineWidth = 5 * s; ctx.strokeRect(width * .65, height * .16, width * .28, height * .24); ctx.beginPath(); ctx.moveTo(width * .72, height * .40); ctx.lineTo(width * .68, height * .47); ctx.lineTo(width * .78, height * .40); ctx.stroke(); for (let i = 0; i < 4; i++) line(width * (.65 + i * .07), height * .44, width * (.69 + i * .07), height * .41, style.a, 2); break;
      case 'glitch': for (let i = 0; i < 12; i++) { const y = height * (.18 + i * .06), x = width * ((i * 37 + Math.floor(time * 21) * (i % 3 + 1)) % 92) / 100; panel(x, y, width * (.035 + (i % 4) * .019), height * (.004 + (i % 3) * .002), i % 2 ? style.a : style.b); } break;
    }
    ctx.restore();
  }

  function titleMotion(style, progress, time, width, height) {
    const enter = ease(Math.min(1, progress / .23));
    const motion = ART_DIRECTIONS[style.id]?.motion || 'rise';
    let x = 0, y = (1 - enter) * height * .028, scale = .96 + enter * .04, rotate = 0, alpha = enter;
    switch (motion) {
      case 'push': scale = 1.12 - .12 * enter; break;
      case 'rise': y = (1 - enter) * height * .06; break;
      case 'pulse': scale = .96 + enter * .04 + Math.sin(time * 3) * .008; break;
      case 'trace': alpha = .22 + .78 * enter; x = (1 - enter) * width * .025; break;
      case 'stack': y = (1 - enter) * height * .10; scale = .96 + .04 * enter; break;
      case 'flicker': alpha = enter * (.91 + .09 * Math.sin(time * 19)); break;
      case 'fade': y = 0; alpha = enter; break;
      case 'bounce': y = (1 - enter) * height * .085 * (1 - enter * .45); scale = .92 + .08 * enter; break;
      case 'ticker': x = (1 - enter) * width * .12; break;
      case 'sway': rotate = Math.sin(time * .8) * .012; y = (1 - enter) * height * .04; break;
      case 'glide': y = (1 - enter) * height * .025; scale = .98 + .02 * enter; break;
      case 'spring': y = (1 - enter) * height * .075 * Math.cos(enter * Math.PI * .5); scale = .90 + .10 * enter; break;
      case 'snap': scale = enter < .8 ? .9 + enter * .2 : 1; break;
      case 'float-up': y = (1 - enter) * height * .11; break;
      case 'orbit': rotate = (1 - enter) * -.04 + Math.sin(time * .2) * .006; break;
      case 'wobble': rotate = (1 - enter) * -.025 + Math.sin(time * 1.7) * .006; break;
      case 'jitter': x = (1 - enter) * width * .06 + Math.sin(time * 28) * width * .002; break;
      case 'slam': scale = .68 + .32 * enter; y = (1 - enter) * height * .05; break;
      case 'glass': y = (1 - enter) * height * .035 + Math.sin(time * .6) * height * .004; alpha *= .94; break;
      case 'lift': y = (1 - enter) * height * .08; rotate = (1 - enter) * .025; break;
      case 'chalk': alpha = .55 + .45 * enter; x = Math.sin(time * 1.1) * width * .001; break;
      case 'breathe': scale = .98 + Math.sin(time * .75) * .012; break;
      case 'assemble': scale = .86 + .14 * enter; rotate = (1 - enter) * .018; break;
      case 'squish': scale = .94 + .06 * enter + Math.sin(time * 1.3) * .009; break;
      case 'contrast': x = (1 - enter) * width * .045; break;
      case 'rotate': rotate = (1 - enter) * -.08; scale = .96 + .04 * enter; break;
      case 'flow': x = Math.sin(time * .5) * width * .004; y = (1 - enter) * height * .03; break;
      case 'dash': x = (1 - enter) * width * .07; break;
      case 'orbit-nodes': rotate = (1 - enter) * .035; break;
      case 'impact': scale = .72 + .28 * enter; rotate = (1 - enter) * -.035; break;
      case 'glitch': x = Math.sin(time * 18) * width * .003 * (1 - enter * .5); alpha = enter * (.9 + .1 * Math.sin(time * 24)); break;
    }
    return { x, y, scale, rotate, alpha };
  }

  function drawFocusTag(style, mode, text, x, y, maxWidth, height) {
    ctx.save();
    ctx.font = `800 ${Math.max(13, canvas.width * .018)}px Inter, sans-serif`;
    const width = Math.min(maxWidth, ctx.measureText(text).width + canvas.width * .06);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    switch (mode) {
      case 'underline': ctx.fillStyle = style.ink; ctx.fillText(text, x, y + height * .38, maxWidth); ctx.fillStyle = style.a; ctx.fillRect(x, y + height * .77, width * .56, Math.max(2, height * .06)); break;
      case 'outline': ctx.strokeStyle = style.a; ctx.lineWidth = Math.max(1, canvas.width * .002); ctx.strokeRect(x, y, width, height); ctx.fillStyle = style.ink; ctx.fillText(text, x + canvas.width * .02, y + height * .5, width - canvas.width * .04); break;
      case 'ticker': case 'terminal': case 'signal': case 'score': ctx.fillStyle = mode === 'terminal' ? style.bg : style.a; ctx.fillRect(x, y, width, height); ctx.fillStyle = mode === 'terminal' ? style.a : style.bg; ctx.fillText(text, x + canvas.width * .02, y + height * .5, width - canvas.width * .04); break;
      case 'hard': ctx.fillStyle = style.a; ctx.fillRect(x, y, width, height); ctx.fillStyle = style.bg; ctx.fillText(text, x + canvas.width * .018, y + height * .5, width - canvas.width * .036); break;
      case 'sticker': case 'bubble': case 'speech': case 'soft': ctx.fillStyle = style.a; roundRect(ctx, x, y, width, height, height * (mode === 'speech' ? .18 : .5)); ctx.fill(); ctx.fillStyle = style.bg; ctx.fillText(text, x + canvas.width * .025, y + height * .5, width - canvas.width * .05); if (mode === 'speech') { ctx.beginPath(); ctx.moveTo(x + width * .15, y + height); ctx.lineTo(x + width * .12, y + height * 1.24); ctx.lineTo(x + width * .28, y + height); ctx.fill(); } break;
      case 'cutout': case 'block': case 'shape': ctx.fillStyle = style.a; ctx.fillRect(x, y, width, height); ctx.fillStyle = style.bg; ctx.fillText(text, x + canvas.width * .022, y + height * .5, width - canvas.width * .044); break;
      case 'plaque': case 'frost': ctx.fillStyle = `${style.a}38`; roundRect(ctx, x, y, width, height, height * .18); ctx.fill(); ctx.strokeStyle = `${style.a}aa`; ctx.stroke(); ctx.fillStyle = style.ink; ctx.fillText(text, x + canvas.width * .022, y + height * .5, width - canvas.width * .044); break;
      case 'mono': ctx.fillStyle = style.ink; ctx.fillText(text, x, y + height * .5, maxWidth); ctx.fillRect(x, y + height * .78, width, Math.max(2, height * .05)); break;
      case 'wave': ctx.fillStyle = style.ink; ctx.fillText(text, x, y + height * .42, maxWidth); ctx.strokeStyle = style.a; ctx.lineWidth = Math.max(2, canvas.width * .003); ctx.beginPath(); ctx.moveTo(x, y + height * .78); ctx.quadraticCurveTo(x + width * .25, y + height * .48, x + width * .5, y + height * .78); ctx.quadraticCurveTo(x + width * .75, y + height * 1.08, x + width, y + height * .72); ctx.stroke(); break;
      case 'subtitle': ctx.fillStyle = style.ink; ctx.fillText(text, x, y + height * .5, maxWidth); break;
      default: ctx.fillStyle = style.a; roundRect(ctx, x, y, width, height, height * .28); ctx.fill(); ctx.fillStyle = style.bg; ctx.fillText(text, x + canvas.width * .028, y + height * .5, width - canvas.width * .05);
    }
    ctx.restore();
    return width;
  }

  function drawCaptionFrame(style, mode, x, y, width, height) {
    ctx.save();
    switch (mode) {
      case 'subtitle': case 'underline': case 'hand-note': ctx.strokeStyle = mode === 'hand-note' ? style.b : style.a; ctx.lineWidth = Math.max(2, canvas.width * .002); ctx.beginPath(); ctx.moveTo(x, y + height * .94); ctx.lineTo(x + width * .52, y + height * .94); ctx.stroke(); break;
      case 'ticker': case 'terminal': case 'signal': case 'score': ctx.fillStyle = mode === 'terminal' ? `${style.bg}ed` : `${style.a}e8`; ctx.fillRect(x, y, width, height); ctx.fillStyle = mode === 'terminal' ? style.a : style.b; ctx.fillRect(x, y, Math.max(4, canvas.width * .008), height); break;
      case 'sticker': case 'bubble': case 'speech': ctx.fillStyle = `${style.a}e8`; roundRect(ctx, x, y, width, height, height * .24); ctx.fill(); if (mode === 'speech') { ctx.beginPath(); ctx.moveTo(x + width * .13, y + height); ctx.lineTo(x + width * .1, y + height * 1.18); ctx.lineTo(x + width * .28, y + height); ctx.fill(); } break;
      case 'hard': case 'cutout': case 'block': case 'shape': ctx.fillStyle = style.a; ctx.fillRect(x, y, width, height); break;
      case 'plaque': case 'frost': case 'glow': ctx.fillStyle = `${style.a}32`; roundRect(ctx, x, y, width, height, height * .16); ctx.fill(); ctx.strokeStyle = `${style.a}aa`; ctx.stroke(); break;
      case 'outline': case 'spec': case 'contour': case 'mono': case 'tile': ctx.strokeStyle = `${style.a}dd`; ctx.lineWidth = Math.max(1, canvas.width * .002); ctx.strokeRect(x, y, width, height); break;
      case 'wave': ctx.strokeStyle = style.a; ctx.lineWidth = Math.max(2, canvas.width * .003); ctx.beginPath(); ctx.moveTo(x, y + height * .9); ctx.quadraticCurveTo(x + width * .24, y + height * .64, x + width * .5, y + height * .9); ctx.quadraticCurveTo(x + width * .77, y + height * 1.16, x + width, y + height * .86); ctx.stroke(); break;
      default: ctx.fillStyle = `${style.bg}ec`; roundRect(ctx, x, y, width, height, height * .2); ctx.fill(); ctx.strokeStyle = `${style.a}88`; ctx.lineWidth = Math.max(1, canvas.width * .0018); ctx.stroke();
    }
    ctx.restore();
  }

  function drawFrame(time) {
    const width = canvas.width;
    const height = canvas.height;
    if (!scenes.length) return;
    const safeTime = Math.max(0, Math.min(time, Math.max(0, duration - .001)));
    const { index, local } = sceneAt(safeTime);
    const scene = scenes[index];
    const style = paletteById[$('Style').value] || paletteById.cinema;
    const direction = ART_DIRECTIONS[style.id] || ART_DIRECTIONS.cinema;
    const [titleX, titleY, titleW, titleAlign, visualX, visualY, visualW, visualH, tagY, captionY, captionH] = direction.box;
    const progress = Math.max(0, Math.min(1, local / Math.max(.01, scene.duration)));
    const margin = width * .085;
    const isVertical = height > width * 1.1;
    const isSquare = Math.abs(width - height) < 3;
    drawBackground(style, safeTime, width, height);
    drawDirectionMotif(style, scene, safeTime, width, height, progress);

    ctx.fillStyle = style.sub;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(16, width * .021)}px ${style.font}, Inter, sans-serif`;
    ctx.fillText('ARKX AUTO Motion  /  EXPLAINER', margin, height * .077);
    ctx.textAlign = 'right';
    ctx.fillStyle = style.a;
    ctx.font = `700 ${Math.max(14, width * .019)}px JetBrains Mono, monospace`;
    if ($('Chapters').checked) ctx.fillText(`${String(index + 1).padStart(2, '0')}  —  ${scene.label}`, width - margin, height * .077);

    const titleFontSize = Math.max(38, width * (isVertical ? .094 : .064) * (direction.motion === 'slam' || direction.motion === 'impact' ? 1.12 : direction.motion === 'fade' ? .90 : 1));
    const titleFont = `800 ${titleFontSize}px "${style.font}", Inter, sans-serif`;
    const titleMaxWidth = width * titleW;
    const titleLines = wrapLines(scene.title, titleMaxWidth, titleFont).slice(0, isVertical ? 4 : 3);
    const titleLineH = titleFontSize * 1.08;
    const titleTop = height * titleY;
    const titleBottom = titleTop + titleLineH * titleLines.length;
    const diagramY = Math.max(height * visualY, titleBottom + height * .022);
    const captionTop = height * captionY;
    const diagramH = Math.min(height * visualH, Math.max(height * .11, captionTop - diagramY - height * .075));
    const motion = titleMotion(style, progress, safeTime, width, height);
    const titleAnchor = titleAlign === 'center' ? width * (titleX + titleW / 2) : titleAlign === 'right' ? width * (titleX + titleW) : width * titleX;
    ctx.save();
    ctx.globalAlpha = motion.alpha;
    ctx.translate(motion.x, motion.y);
    ctx.translate(titleAnchor, titleTop);
    ctx.rotate(motion.rotate);
    ctx.scale(motion.scale, motion.scale);
    ctx.translate(-titleAnchor, -titleTop);
    ctx.font = titleFont;
    ctx.textAlign = titleAlign; ctx.textBaseline = 'top';
    for (let i = 0; i < titleLines.length; i += 1) {
      ctx.fillStyle = i === 0 && scene.index === 0 ? style.a : style.ink;
      ctx.fillText(titleLines[i], titleAnchor, titleTop + i * titleLineH, titleMaxWidth);
    }
    ctx.restore();

    if ($('MotionShapes').checked) window.AutoMotionNarrative.drawVisual(ctx, scene, { x: width * visualX, y: diagramY, w: width * visualW, h: diagramH }, progress, safeTime, style);

    const focusText = scene.focus.length ? scene.focus.slice(0, 2).join('  ·  ').toUpperCase() : scene.label;
    const tagHeight = Math.max(36, height * .031);
    const tagLeft = titleAlign === 'right' ? width * .16 : titleAlign === 'center' ? width * .5 - width * .30 : margin;
    const focusY = Math.min(captionTop - tagHeight - height * .012, Math.max(height * tagY, diagramY + diagramH + height * .012));
    drawFocusTag(style, direction.tag, focusText, tagLeft, focusY, width * .66, tagHeight);

    if ($('Caption').value !== 'none') {
      const captionFont = Math.max(17, width * .024);
      const boxY = height * captionY;
      const boxH = height * captionH;
      const boxX = margin;
      const boxW = width - margin * 2;
      drawCaptionFrame(style, direction.tag, boxX, boxY, boxW, boxH);
      window.AutoMotionNarrative.drawKineticCaption(ctx, scene, safeTime, boxX + width * .025, boxY + height * .008, boxW - width * .05, boxH - height * .016, captionFont, style, $('Caption').value);
    }
    window.AutoMotionNarrative.drawTransition(ctx, local, width, height, style);

    const barY = height * .955;
    ctx.fillStyle = '#ffffff25';
    roundRect(ctx, margin, barY, width - margin * 2, Math.max(4, height * .004), height * .004); ctx.fill();
    ctx.fillStyle = style.a;
    roundRect(ctx, margin, barY, (width - margin * 2) * Math.min(1, safeTime / Math.max(1, duration)), Math.max(4, height * .004), height * .004); ctx.fill();
    $('SceneCounter').textContent = `${String(index + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}`;
    $('PreviewTitle').textContent = scene.title;
    $('PreviewDescription').textContent = `${scene.label} · ${scene.visualName} · sorotan kata mengikuti waktu VO (estimasi)`;
    $('SceneMeta').textContent = `${$('Style').selectedOptions[0].textContent.toUpperCase()} · ${scenes.length} SCENE`;
    setActiveScene(index, progress);
    updateSeek(safeTime);
  }

  function renderSceneList(active = 0) {
    const container = $('Scenes');
    container.replaceChildren();
    sceneButtons = [];
    let cursor = 0;
    scenes.forEach((scene, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `am-idea-scene${index === active ? ' active' : ''}`;
      button.setAttribute('aria-label', `Lompat ke scene ${index + 1}: ${scene.title}`);
      const top = document.createElement('div'); top.className = 'am-idea-scene-top';
      const number = document.createElement('span'); number.className = 'am-idea-scene-num'; number.textContent = `SCENE ${String(index + 1).padStart(2, '0')}`;
      const time = document.createElement('span'); time.className = 'am-idea-scene-time'; time.textContent = `${scene.duration.toFixed(1)}s`;
      top.append(number, time);
      const title = document.createElement('div'); title.className = 'am-idea-scene-title'; title.textContent = scene.title;
      const type = document.createElement('div'); type.className = 'am-idea-scene-type'; type.textContent = `${scene.label} · ${scene.visualName} · ${scene.focus.slice(0, 2).join(', ')}`;
      const bar = document.createElement('div'); bar.className = 'am-idea-scene-bar';
      const fill = document.createElement('i'); bar.append(fill);
      const start = cursor; cursor += scene.duration;
      button.append(top, title, type, bar);
      button.addEventListener('click', () => {
        if (exporting) return;
        playing = false; cancelAnimationFrame(raf); frozenAt = start;
        audio.pause(); updatePlayButton(); drawFrame(start);
        if (voiceFile) audio.currentTime = Math.min(start, audio.duration || start);
      });
      container.append(button); sceneButtons.push(button);
    });
    $('TimelineInfo').textContent = `${scenes.length} scene · ${Math.ceil(duration)} dtk${voiceFile ? ' · VO tersinkron' : ''}`;
    $('SceneMeta').textContent = `${$('Style').selectedOptions[0].textContent.toUpperCase()} · ${scenes.length} SCENE`;
    if (scenes.length) drawFrame(Math.min(duration - .001, Math.max(0, frozenAt)));
  }

  function currentTime() {
    if (playing && voiceFile && !audio.paused && Number.isFinite(audio.currentTime)) return Math.min(duration, audio.currentTime);
    return playing ? Math.min(duration, (performance.now() - startedAt) / 1000) : frozenAt;
  }

  function updatePlayButton() {
    const button = $('PlayBtn');
    button.textContent = playing ? 'Ⅱ' : '▶';
    button.setAttribute('aria-label', playing ? 'Jeda preview' : 'Putar preview');
  }

  function tick() {
    if (!playing) return;
    const time = currentTime();
    if (time >= duration) {
      playing = false; frozenAt = Math.max(0, duration - .01); audio.pause(); updatePlayButton(); drawFrame(frozenAt); return;
    }
    drawFrame(time);
    raf = requestAnimationFrame(tick);
  }

  function updateMode(next) {
    mode = next;
    $('IdeaTab').classList.toggle('active', next === 'idea');
    $('ScriptTab').classList.toggle('active', next === 'script');
    $('IdeaTab').setAttribute('aria-selected', String(next === 'idea'));
    $('ScriptTab').setAttribute('aria-selected', String(next === 'script'));
    $('InputLabel').textContent = next === 'idea' ? 'Ceritakan idemu' : 'Tempel naskah narasi';
    $('SourceText').placeholder = next === 'idea' ? 'Contoh: Mengapa kebiasaan kecil lebih mudah bertahan?' : 'Tempel naskah utuhmu. Pisahkan gagasan dengan titik atau jeda paragraf.';
    $('InputHelp').textContent = next === 'idea' ? 'Tulis gagasan utama. Narasi beberapa kalimat akan dirangkai menjadi beberapa scene.' : 'Scene mengikuti kalimat/paragraf; maksimum 48 scene per komposisi untuk menjaga performa browser.';
  }

  function resizeCanvas() {
    const [width, height] = formats[$('Format').value] || formats.vertical;
    canvas.width = width; canvas.height = height;
    const stage = document.querySelector('.am-idea-stage');
    stage.dataset.ratio = $('Format').value;
    drawFrame(currentTime());
  }

  function openStudio() {
    playing = false; audio.pause(); cancelAnimationFrame(raf); updatePlayButton();
    root.hidden = false;
    checkTtsStatus();
    if (landing) landing.hidden = true;
    const originalStudio = document.getElementById('studio');
    if (originalStudio) originalStudio.hidden = true;
    document.body.classList.add('am-idea-open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('SourceText').focus({ preventScroll: true });
  }

  function closeStudio() {
    if (exporting) { showToast('Tunggu sampai ekspor video selesai.'); return; }
    playing = false; audio.pause(); cancelAnimationFrame(raf); updatePlayButton();
    root.hidden = true;
    if (landing) landing.hidden = false;
    document.body.classList.remove('am-idea-open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function playPause() {
    if (!scenes.length || exporting) return;
    if (playing) {
      frozenAt = currentTime(); playing = false; cancelAnimationFrame(raf); audio.pause();
    } else {
      if (frozenAt >= duration - .05) frozenAt = 0;
      if (voiceFile) {
        audio.currentTime = Math.min(frozenAt, Number.isFinite(audio.duration) ? audio.duration : frozenAt);
        try { await audio.play(); }
        catch { showToast('Audio belum dapat diputar. Coba tombol putar pada pemutar VO.'); return; }
      }
      startedAt = performance.now() - frozenAt * 1000;
      playing = true; tick();
    }
    updatePlayButton();
  }

  function setExportControls(busy) {
    ['GenerateBtn', 'SourceText', 'Style', 'Pace', 'Caption', 'Format', 'Chapters', 'MotionShapes', 'IdeaTab', 'ScriptTab', 'Back', 'PlayBtn', 'VoicePick', 'VoiceClear', 'VoiceDownload', 'VoiceInput', 'VoiceVolume', 'TtsGenerate', 'TtsVoice', 'TtsTone'].forEach((id) => { $(id).disabled = busy; });
    audio.controls = !busy;
    sceneButtons.forEach((button) => { button.disabled = busy; });
  }

  function cleanupExport() {
    exporting = false;
    audio.pause();
    if (exportAudioSource) { try { exportAudioSource.stop(); } catch {} exportAudioSource.disconnect(); exportAudioSource = null; }
    if (exportAudioContext) { exportAudioContext.close().catch(() => {}); exportAudioContext = null; }
    if (exportAudioStream) exportAudioStream.getTracks().forEach((track) => track.stop());
    if (exportVideoStream) exportVideoStream.getTracks().forEach((track) => track.stop());
    exportAudioStream = null; exportVideoStream = null;
    if (exportRecorder && exportRecorder.state !== 'inactive') { try { exportRecorder.stop(); } catch {} }
    exportRecorder = null;
    $('ExportBtn').disabled = false;
    $('ExportBtn').textContent = '↓  Ekspor video WebM';
    setExportControls(false);
  }

  async function exportWebM() {
    if (!scenes.length || exporting || ttsBusy) return;
    if (!canvas.captureStream || !window.MediaRecorder) { showToast('Ekspor WebM tidak didukung browser ini. Coba Chrome atau Edge terbaru.'); return; }
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) { showToast('Browser ini belum mendukung perekaman WebM.'); return; }

    playing = false; cancelAnimationFrame(raf); audio.pause(); frozenAt = 0; drawFrame(0); updatePlayButton();
    const videoStream = canvas.captureStream(30);
    exportVideoStream = videoStream;
    const tracks = [...videoStream.getVideoTracks()];
    if (voiceBuffer) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('Web Audio tidak tersedia');
        exportAudioContext = new AudioContextClass();
        await exportAudioContext.resume();
        const destination = exportAudioContext.createMediaStreamDestination();
        exportAudioStream = destination.stream;
        exportAudioSource = exportAudioContext.createBufferSource();
        exportAudioSource.buffer = voiceBuffer;
        const gain = exportAudioContext.createGain();
        gain.gain.value = Number($('VoiceVolume').value);
        exportAudioSource.connect(gain).connect(destination);
        tracks.push(...exportAudioStream.getAudioTracks());
      } catch (error) {
        videoStream.getTracks().forEach((track) => track.stop());
        cleanupExport();
        showToast('Audio tidak dapat disiapkan untuk ekspor. Coba berkas audio lain.');
        return;
      }
    }
    const stream = new MediaStream(tracks);
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6500000, audioBitsPerSecond: 192000 });
    exportRecorder = recorder;
    exporting = true; $('ExportBtn').disabled = true; setExportControls(true);
    $('ExportBtn').textContent = 'Merekam composition…';
    $('RenderMode').textContent = voiceBuffer ? 'RENDER LOKAL · VIDEO + VO' : 'RENDER LOKAL · VIDEO TANPA VO';
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { cleanupExport(); showToast('Ekspor gagal. Coba browser Chromium terbaru.'); };
    recorder.onstop = () => {
      if (chunks.length) {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = 'arkx-auto-motion-explainer.webm'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        showToast(voiceBuffer ? 'Video WebM dengan voice-over berhasil dibuat.' : 'Video WebM berhasil dibuat. Belum ada VO pada file ini.');
      }
      cleanupExport();
    };
    try {
      recorder.start(250);
      const startClock = performance.now();
      if (exportAudioSource) exportAudioSource.start(exportAudioContext.currentTime + .06);
      const draw = () => {
        const elapsed = (performance.now() - startClock) / 1000;
        frozenAt = Math.min(elapsed, Math.max(0, duration - .001));
        drawFrame(frozenAt);
        if (elapsed < duration) raf = requestAnimationFrame(draw);
        else setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 120);
      };
      draw();
    } catch (error) {
      videoStream.getTracks().forEach((track) => track.stop());
      cleanupExport(); showToast('Browser tidak dapat memulai ekspor WebM.');
    }
  }

  async function addVoice(file) {
    if (!file) return false;
    if (!file.type.startsWith('audio/')) { showToast('Pilih berkas audio VO.'); return false; }
    if (file.size > 40 * 1024 * 1024) { showToast('Ukuran audio VO maksimum 40 MB.'); return false; }
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio tidak tersedia');
      if (!voiceAudioContext || voiceAudioContext.state === 'closed') voiceAudioContext = new AudioContextClass();
      const bytes = await file.arrayBuffer();
      const decoded = await voiceAudioContext.decodeAudioData(bytes.slice(0));
      if (!decoded.length || !Number.isFinite(decoded.duration)) throw new Error('audio-empty');
      playing = false; audio.pause(); cancelAnimationFrame(raf); frozenAt = 0; updatePlayButton();
      if (voiceObjectUrl) URL.revokeObjectURL(voiceObjectUrl);
      voiceBuffer = decoded;
      voiceFile = file;
      voiceObjectUrl = URL.createObjectURL(file);
      audio.src = voiceObjectUrl;
      audio.hidden = false;
      audio.volume = Math.min(1, Number($('VoiceVolume').value));
      audio.load();
      $('VoiceStatus').textContent = `VO siap · ${formatTime(voiceBuffer.duration)} · ikut ekspor`;
      $('VoiceName').textContent = file.name;
      $('VoiceMeter').hidden = false;
      $('VoiceClear').hidden = false;
      $('VoiceDownload').hidden = false;
      if (scenes.length) {
        alignScenesToVoice(); renderSceneList(Math.max(0, activeScene));
      }
      $('TimelineInfo').textContent = `${scenes.length} scene · ${Math.ceil(duration)} dtk · VO tersinkron`;
      $('ExportNote').textContent = `Ekspor WebM akan menyertakan VO (${formatTime(voiceBuffer.duration)}), dengan volume yang kamu atur.`;
      showToast('Voice-over siap dan akan disertakan di ekspor.');
      return true;
    } catch (error) {
      showToast('Audio gagal dibaca. Coba berkas WAV, MP3, M4A, atau OGG.');
      return false;
    }
  }

  function ttsStatus(message, state = '') {
    $('TtsStatus').textContent = message;
    $('TtsStatus').dataset.state = state;
  }

  async function checkTtsStatus() {
    if (ttsBusy || voiceFile) return;
    try {
      const response = await fetch('/api/tts/status', { cache: 'no-store' });
      const status = await response.json();
      if (!ttsBusy && !voiceFile) ttsStatus(status.configured ? 'Gemini siap · pilih suara, lalu buat voice-over.' : 'Gemini belum dikonfigurasi di server. Impor VO tetap tersedia.', status.configured ? 'ready' : 'error');
    } catch {
      if (!ttsBusy && !voiceFile) ttsStatus('Koneksi Gemini belum dapat diperiksa. Kamu tetap bisa mencoba membuat VO.');
    }
  }

  function downloadVoice() {
    if (!voiceBuffer || exporting || ttsBusy) return;
    const channels = Math.min(2, voiceBuffer.numberOfChannels);
    const size = voiceBuffer.length * channels * 2;
    const bytes = new ArrayBuffer(44 + size);
    const view = new DataView(bytes);
    const write = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    write(0, 'RIFF'); view.setUint32(4, 36 + size, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, voiceBuffer.sampleRate, true); view.setUint32(28, voiceBuffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, size, true);
    const data = Array.from({ length: channels }, (_, index) => voiceBuffer.getChannelData(index));
    let offset = 44;
    for (let index = 0; index < voiceBuffer.length; index += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const value = Math.max(-1, Math.min(1, data[channel][index]));
        view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true); offset += 2;
      }
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const link = document.createElement('a'); link.href = url; link.download = 'arkx-auto-motion-voice-over.wav';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast('Audio WAV berhasil disiapkan untuk diunduh.');
  }

  async function generateTts() {
    if (exporting || ttsBusy) return;
    const text = $('SourceText').value.trim();
    if (!text) { showToast('Tulis naskah dulu sebelum membuat voice-over.'); $('SourceText').focus(); return; }
    if (text.length > 2500) { showToast('Naskah TTS maksimum 2.500 karakter.'); return; }
    const button = $('TtsGenerate');
    const voice = $('TtsVoice').value;
    const delivery = $('TtsTone').value;
    ttsBusy = true;
    setExportControls(true); $('ExportBtn').disabled = true;
    button.textContent = 'Membuat voice-over…';
    ttsStatus('Gemini sedang membuat audio. Tunggu hingga selesai; jangan tutup halaman.', 'loading');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, delivery }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let code = 'tts_unavailable';
        try { code = (await response.json()).error || code; } catch {}
        const messages = {
          tts_not_configured: 'Backend TTS belum dikonfigurasi untuk preview ini.',
          origin_denied: 'Permintaan TTS ditolak oleh pemeriksaan keamanan.',
          rate_limited: 'Batas permintaan TTS tercapai. Coba lagi beberapa saat.',
          tts_quota: 'Kuota Gemini TTS sedang terbatas. Coba lagi nanti.',
          text_too_long: 'Naskah terlalu panjang untuk satu permintaan TTS.',
          tts_request_rejected: 'Gemini belum menerima naskah ini. Periksa teks lalu coba lagi.',
          tts_permission_denied: 'Akses Gemini untuk kunci server ini ditolak. Periksa izin API di server.',
          tts_model_unavailable: 'Model suara belum tersedia untuk akun ini.',
          tts_timeout: 'Gemini membutuhkan waktu terlalu lama. Silakan coba kembali.',
          tts_empty: 'Gemini belum mengirim audio. Silakan coba kembali.',
          tts_format_invalid: 'Format audio Gemini belum dapat dibaca. Silakan coba kembali.',
        };
        const message = messages[code] || 'Voice-over belum berhasil dibuat. Coba lagi sebentar.';
        ttsStatus(message, 'error'); showToast(message);
        return;
      }
      const blob = await response.blob();
      if (!blob.type.toLowerCase().startsWith('audio/')) throw new Error('invalid-audio-response');
      scenes = buildScenes(text); frozenAt = 0;
      const ready = await addVoice(new File([blob], `auto-motion-vo-${voice.toLowerCase()}.wav`, { type: 'audio/wav' }));
      if (!ready) throw new Error('audio-decode');
      ttsStatus(`Voice-over ${voice} siap. Putar audio, unduh WAV, atau ekspor video dengan VO.`, 'success');
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Pembuatan VO melewati batas waktu. Silakan coba kembali.' : error.message === 'audio-decode' ? 'Audio diterima, tetapi browser belum dapat membacanya. Coba kembali.' : 'Layanan TTS tidak dapat dihubungi. Kamu tetap bisa mengimpor rekaman VO sendiri.';
      ttsStatus(message, 'error'); showToast(message);
    } finally {
      clearTimeout(timeout); ttsBusy = false;
      setExportControls(false); $('ExportBtn').disabled = false;
      button.textContent = '✦ Buat voice-over dari naskah';
    }
  }

  function clearVoice() {
    if (exporting || ttsBusy) return;
    audio.pause(); audio.removeAttribute('src'); audio.load();
    audio.hidden = true;
    if (voiceObjectUrl) URL.revokeObjectURL(voiceObjectUrl);
    voiceObjectUrl = ''; voiceFile = null; voiceBuffer = null;
    $('VoiceInput').value = ''; $('VoiceStatus').textContent = 'Belum ada audio · video ekspor tanpa VO';
    $('VoiceMeter').hidden = true; $('VoiceClear').hidden = true;
    $('VoiceDownload').hidden = true;
    ttsStatus('VO dihapus. Pilih suara lalu buat voice-over baru.');
    $('ExportNote').textContent = 'File video dibuat di browser; tanpa VO sampai kamu menambahkan audio.';
    if (scenes.length) { scenes = buildScenes($('SourceText').value.trim()); alignScenesToVoice(); renderSceneList(0); frozenAt = 0; }
    $('TimelineInfo').textContent = `${scenes.length} scene · ${Math.ceil(duration)} dtk`;
  }

  function generate() {
    if (exporting) return;
    const text = $('SourceText').value.trim();
    if (!text) { showToast('Tulis ide atau tempel naskah dulu.'); $('SourceText').focus(); return; }
    playing = false; audio.pause(); cancelAnimationFrame(raf);
    const button = $('GenerateBtn'); const label = button.querySelector('[data-label]');
    button.disabled = true; label.textContent = 'Membuat papan cerita ilustratif…';
    setTimeout(() => {
      scenes = buildScenes(text); alignScenesToVoice(); frozenAt = 0;
      renderSceneList(0); drawFrame(0); updatePlayButton();
      button.disabled = false; label.textContent = 'Susun scene narasi';
      showToast(`${scenes.length} scene siap${voiceFile ? ' · VO tersinkron' : ''}. Preview lokal siap diputar.`);
    }, 90);
  }

  function seekByPointer(event) {
    if (!duration || exporting) return;
    const rect = $('Seek').getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    frozenAt = ratio * duration; playing = false; audio.pause(); cancelAnimationFrame(raf);
    if (voiceFile) audio.currentTime = Math.min(frozenAt, audio.duration || frozenAt);
    updatePlayButton(); drawFrame(frozenAt);
  }

  $('Start').addEventListener('click', openStudio);
  $('Back').addEventListener('click', closeStudio);
  $('IdeaTab').addEventListener('click', () => updateMode('idea'));
  $('ScriptTab').addEventListener('click', () => updateMode('script'));
  $('SourceText').addEventListener('input', () => { $('CharCount').textContent = `${$('SourceText').value.length.toLocaleString('id-ID')} karakter`; });
  $('GenerateBtn').addEventListener('click', generate);
  $('PlayBtn').addEventListener('click', playPause);
  $('ExportBtn').addEventListener('click', exportWebM);
  $('Style').addEventListener('change', () => { syncStyleButtons(); drawFrame(currentTime()); });
  $('Chapters').addEventListener('change', () => drawFrame(currentTime()));
  $('MotionShapes').addEventListener('change', () => drawFrame(currentTime()));
  $('Caption').addEventListener('change', () => drawFrame(currentTime()));
  $('Pace').addEventListener('change', () => { if ($('SourceText').value.trim()) generate(); });
  $('Format').addEventListener('change', resizeCanvas);
  $('VoicePick').addEventListener('click', () => $('VoiceInput').click());
  $('VoiceInput').addEventListener('change', (event) => addVoice(event.target.files?.[0]));
  $('VoiceClear').addEventListener('click', clearVoice);
  $('VoiceDownload').addEventListener('click', downloadVoice);
  $('TtsGenerate').addEventListener('click', generateTts);
  $('VoiceVolume').addEventListener('input', () => {
    audio.volume = Math.min(1, Number($('VoiceVolume').value));
    if (voiceFile) $('ExportNote').textContent = `Volume VO ${Math.round(Number($('VoiceVolume').value) * 100)}% · ikut ekspor WebM.`;
  });
  $('Seek').addEventListener('pointerdown', seekByPointer);
  $('Seek').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? duration : Math.max(0, Math.min(duration, currentTime() + (event.key === 'ArrowRight' ? 1 : -1)));
    frozenAt = next; playing = false; audio.pause(); drawFrame(next); updatePlayButton();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !root.hidden) closeStudio(); });

  initStyleGrid();
  $('SourceText').value = sample;
  $('CharCount').textContent = `${sample.length} karakter`;
  scenes = buildScenes(sample);
  alignScenesToVoice();
  resizeCanvas();
  renderSceneList(0);
  drawFrame(0);
  updatePlayButton();
})();
