import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/narrative-engine.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(source, { window, Math, Set, Object, Array, String, Number });
const engine = window.AutoMotionNarrative;

const noOpContext = new Proxy({}, {
  get(target, key) {
    if (key === 'measureText') return (text) => ({ width: String(text).length * 15 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (!(key in target)) target[key] = () => {};
    return target[key];
  },
  set(target, key, value) { target[key] = value; return true; },
});

 test('education scripts map to topic-specific visuals rather than cycling generic diagrams', () => {
  const scenes = engine.buildScenes('Gula masuk ke banyak makanan. Tubuh mengolah gula sebagai bagian dari proses penyediaan energi. Memahami label makanan dan ukuran porsi membantu pilihan yang lebih sadar.');
  assert.equal(scenes.length, 3);
  assert.equal(scenes[0].visual, 'sugar');
  assert.equal(scenes[1].visual, 'sugar');
  assert.equal(scenes[2].visual, 'food');
  assert.equal(scenes[0].label, 'KONTEKS');
  assert.equal(scenes[2].label, 'KESIMPULAN');
  assert.ok(!scenes.some((scene) => /CTA|PROMO|AFFILIATE|PRODUK/i.test(scene.label)));
});

test('life, cause/effect, and environmental narratives choose distinct illustrative treatments', () => {
  assert.equal(engine.classify('Kebiasaan kecil membentuk kehidupan keluarga dan masyarakat.'), 'life');
  assert.equal(engine.classify('Polusi udara meningkat saat hutan berkurang dan iklim berubah.'), 'nature');
  assert.equal(engine.classify('Kurang tidur dapat berdampak pada kesehatan tubuh.'), 'body');
  assert.equal(engine.classify('Ponsel dan jaringan digital mengubah cara orang berkomunikasi.'), 'tech');
  assert.equal(engine.classify('Sebab kebiasaan berubah, akibatnya pilihan sehari-hari ikut berubah.'), 'life');
});

test('scene timing covers the complete VO duration and every spoken word receives an ordered interval', () => {
  const scenes = engine.buildScenes('Gula tersedia dalam banyak makanan. Tubuh memakai energi dalam beragam proses.');
  const total = engine.syncTimings(scenes, 6.2);
  assert.ok(total >= 6.2 - 1e-8);
  assert.ok(Math.abs(scenes.reduce((sum, scene) => sum + scene.duration, 0) - total) < 1e-8);
  for (const scene of scenes) {
    assert.equal(scene.wordTimings.length, scene.words.length);
    assert.ok(scene.wordTimings.every((word, index) => word.end > word.start && (index === 0 || word.start >= scene.wordTimings[index - 1].end)));
  }
});

test('scene plans cap the browser composition at 48 without adding invented statistics', () => {
  const long = Array.from({ length: 60 }, (_, index) => `Topik kehidupan nomor ${index + 1} dibahas dengan narasi yang sederhana.`).join(' ');
  const scenes = engine.buildScenes(long);
  assert.equal(scenes.length, 48);
  assert.ok(!JSON.stringify(scenes).includes('%'));
});

test('illustration, kinetic caption, and transition drawing work with a canvas context', () => {
  const scene = engine.buildScenes('Gula hadir dalam banyak makanan dan menjadi bagian dari proses tubuh.')[0];
  engine.syncTimings([scene], 3.5);
  const style = { a: '#ffb778', b: '#ff643f', bg: '#080b14', ink: '#f8f4f1', sub: '#bcb8c4', font: 'Inter' };
  assert.doesNotThrow(() => engine.drawVisual(noOpContext, scene, { x: 0, y: 0, w: 900, h: 420 }, .5, 1.1, style));
  assert.doesNotThrow(() => engine.drawKineticCaption(noOpContext, scene, 1.1, 0, 0, 900, 100, 24, style, 'highlight'));
  assert.doesNotThrow(() => engine.drawTransition(noOpContext, .1, 1080, 1920, style));
});

test('all 31 visual art directions remain available and the page loads the narrative engine', () => {
  const js = fs.readFileSync(new URL('../public/idea-animation.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const styleIds = [...js.matchAll(/\{ id: '([a-z-]+)', name:/g)].map((match) => match[1]);
  const directions = [...js.matchAll(/^    ([a-z]+): \{ box: \[([^\]]+)\], motion: '([^']+)', tag: '([^']+)' \},$/gm)];
  assert.equal(styleIds.length, 31);
  assert.deepEqual(directions.map((match) => match[1]), styleIds);
  assert.equal(new Set(directions.map((match) => `${match[2]}|${match[3]}|${match[4]}`)).size, 31);
  assert.ok(html.includes('./narrative-engine.js'));
  assert.ok(html.includes('amIdeaIdeaTab') && html.includes('amIdeaScriptTab'));
  assert.ok(html.includes('WORKSPACE TERPISAH'));
});
