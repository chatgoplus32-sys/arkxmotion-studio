(() => {
  const STOP = new Set('yang dan atau untuk dari dengan pada dalam bisa akan agar lalu karena setelah sebelum sebuah suatu ini itu ke di nya lebih sangat juga saat secara hingga serta oleh adalah jadi sebagai kecil besar ketika dapat tanpa mulai kepada terhadap antara sebagai kita mereka untuknya'.split(' '));
  const GROUPS = {
    sugar: ['gula','glukosa','sukrosa','fruktosa','pemanis','manis','karbohidrat','insulin','pankreas','kadar','gula darah'],
    body: ['tubuh','jantung','darah','otak','kesehatan','sehat','energi','tidur','stres','napas','otot','pencernaan','sel','organ','hormon','metabolisme','makan'],
    food: ['makanan','minuman','buah','sayur','nasi','roti','kopi','teh','garam','lemak','protein','sarapan','piring','masak','nutrisi','gizi','porsi','label'],
    nature: ['alam','bumi','hutan','pohon','daun','tanaman','laut','sungai','air','hujan','iklim','cuaca','udara','polusi','karbon','hewan','lingkungan','panas','es'],
    tech: ['teknologi','digital','internet','ponsel','telepon','komputer','data','aplikasi','algoritma','robot','ai','kecerdasan','sistem','layar','jaringan','sinyal','chip'],
    life: ['hidup','kehidupan','manusia','orang','keluarga','anak','teman','masyarakat','kota','rumah','kebiasaan','pilihan','perasaan','emosi','kerja','belajar','sekolah','budaya','hubungan','komunitas'],
    time: ['dulu','sekarang','masa','sejarah','abad','tahun','generasi','perubahan','berubah','akhirnya','mulanya','perjalanan','zaman','lalu']
  };
  const NAMES = { sugar: 'Alur gula dalam tubuh · ilustrasi', body: 'Tubuh & kesehatan · ilustrasi', food: 'Pangan & kebiasaan · ilustrasi', nature: 'Alam & lingkungan · ilustrasi', tech: 'Teknologi & jaringan · ilustrasi', life: 'Kehidupan sehari-hari · ilustrasi', time: 'Perubahan dari waktu ke waktu', cause: 'Hubungan sebab dan akibat', process: 'Urutan proses', compare: 'Perbandingan konsep', concept: 'Ilustrasi konsep' };
  const LABELS = { sugar: 'METABOLISME', body: 'TUBUH', food: 'PANGAN', nature: 'LINGKUNGAN', tech: 'TEKNOLOGI', life: 'KEHIDUPAN', time: 'PERUBAHAN', cause: 'SEBAB → AKIBAT', process: 'PROSES', compare: 'PERBANDINGAN', concept: 'GAGASAN' };
  const tokens = (text) => (String(text || '').match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*[,.!?;:…]?/gu) || []);
  const scoreGroup = (words, terms) => words.reduce((score, word) => score + terms.reduce((sum, term) => sum + (word === term ? 3 : word.startsWith(term) || term.startsWith(word) ? 1 : 0), 0), 0);

  function splitText(text) {
    const normalized = String(text || '').replace(/\r/g, '').trim();
    if (!normalized) return [];
    const paragraphs = normalized.split(/\n+/).map((part) => part.trim()).filter(Boolean);
    let parts = paragraphs.flatMap((part) => part.match(/[^.!?;…]+[.!?;…]?/g) || []).map((part) => part.trim()).filter(Boolean);
    if (!parts.length) parts = [normalized];
    const expanded = [];
    for (const part of parts) {
      const words = part.split(/\s+/);
      if (words.length <= 22) { expanded.push(part); continue; }
      let start = 0;
      while (start < words.length) {
        let end = Math.min(words.length, start + 18);
        if (end < words.length) {
          const preferred = words.slice(start + 10, end).findLastIndex((word) => /[,;:]$/.test(word));
          if (preferred >= 0) end = start + 10 + preferred + 1;
        }
        expanded.push(words.slice(start, end).join(' ').replace(/[,:;]+$/, '') + (end < words.length ? '…' : ''));
        start = end;
      }
    }
    return expanded.slice(0, 48);
  }

  function focusWords(text) {
    const words = tokens(text).map((word) => word.toLowerCase().replace(/[,.!?;:…]+$/, ''));
    const ranked = words.filter((word) => word.length > 3 && !STOP.has(word));
    const prioritized = [...ranked].sort((a, b) => (scoreGroup([b], Object.values(GROUPS).flat()) - scoreGroup([a], Object.values(GROUPS).flat())) || ranked.indexOf(a) - ranked.indexOf(b));
    return [...new Set((prioritized.length ? prioritized : words).slice(0, 4))].slice(0, 3);
  }

  function classify(text) {
    const lower = text.toLowerCase();
    const words = tokens(lower);
    const scores = Object.fromEntries(Object.entries(GROUPS).map(([name, terms]) => [name, scoreGroup(words, terms)]));
    const ordered = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    if (scores.sugar >= 3) return 'sugar';
    if (scores.body >= 3 && scores.body >= scores.food) return 'body';
    if (scores.food >= 3) return 'food';
    if (scores.nature >= 3) return 'nature';
    if (scores.tech >= 3) return 'tech';
    if (scores.life >= 2) return 'life';
    if (scores.time >= 2 || /\b(abad|tahun|generasi|zaman)\b/.test(lower)) return 'time';
    if (/\b(banding|dibanding|berbeda|sementara|sedangkan|daripada|lebih tinggi|lebih rendah)\b/.test(lower)) return 'compare';
    if (/\b(karena|sebab|akibat|menyebabkan|berdampak|sehingga|maka|oleh sebab)\b/.test(lower)) return 'cause';
    if (/\b(pertama|kedua|ketiga|kemudian|selanjutnya|langkah|proses|tahap|mula-mula|akhirnya)\b/.test(lower)) return 'process';
    if (ordered[0]?.[1] > 0) return ordered[0][0];
    return 'concept';
  }

  function buildScenes(text, pace = 'balanced') {
    const parts = splitText(text);
    const paceScale = pace === 'calm' ? 1.28 : pace === 'energetic' ? 0.82 : 1;
    return parts.map((sentence, index) => {
      const words = tokens(sentence);
      const visual = classify(sentence);
      const focus = focusWords(sentence);
      const plainTitle = sentence.replace(/[.!?;…]+$/, '').trim();
      const title = plainTitle.length > 86 ? `${plainTitle.slice(0, 82).replace(/\s+\S*$/, '')}…` : plainTitle;
      const duration = Math.max(2.2, Math.min(8, (1.65 + words.length * 0.21) * paceScale));
      const label = index === 0 ? (/\?/.test(sentence) ? 'PERTANYAAN' : 'KONTEKS') : index === parts.length - 1 ? 'KESIMPULAN' : LABELS[visual];
      return { sentence, title, focus, duration, label, index, visual, visualName: NAMES[visual], wordCount: words.length, words, wordTimings: [] };
    });
  }

  function wordWeight(word, sentence) {
    const syllables = Math.max(1, (word.toLowerCase().match(/[aiueo]+/g) || []).length);
    const punctuation = sentence.endsWith(word) ? (/[,;:]$/.test(sentence) ? .42 : /[.!?…]$/.test(sentence) ? .9 : 0) : 0;
    return .48 + syllables * .24 + Math.min(.28, Math.max(0, word.length - 5) * .035) + punctuation;
  }

  function syncTimings(scenes, requestedDuration) {
    if (!scenes.length) return 0;
    const baseDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
    const target = Number.isFinite(requestedDuration) && requestedDuration > 0 ? Math.max(requestedDuration, scenes.length * 1.35) : baseDuration;
    const min = Math.min(1.35, target / scenes.length);
    const weights = scenes.map((scene) => scene.words.reduce((sum, word) => sum + wordWeight(word, scene.sentence), 0) || 1);
    let free = scenes.map((_, index) => index);
    let remaining = target;
    const durations = Array(scenes.length).fill(0);
    while (free.length) {
      const sum = free.reduce((total, index) => total + weights[index], 0);
      const short = free.filter((index) => remaining * weights[index] / sum < min);
      if (!short.length) { free.forEach((index) => { durations[index] = remaining * weights[index] / sum; }); break; }
      short.forEach((index) => { durations[index] = min; remaining -= min; });
      free = free.filter((index) => !short.includes(index));
      if (remaining <= 0) break;
    }
    let cursor = 0;
    scenes.forEach((scene, index) => {
      scene.startTime = cursor;
      scene.duration = durations[index] || min;
      scene.wordTimings = [];
      const wordWeights = scene.words.map((word) => wordWeight(word, scene.sentence));
      const total = wordWeights.reduce((sum, weight) => sum + weight, 0) || 1;
      let wordCursor = cursor;
      scene.words.forEach((word, wordIndex) => {
        const wordDuration = scene.duration * wordWeights[wordIndex] / total;
        scene.wordTimings.push({ word, index: wordIndex, start: wordCursor, end: wordCursor + wordDuration });
        wordCursor += wordDuration;
      });
      cursor += scene.duration;
    });
    return cursor;
  }

  const ease = (value) => { const p = Math.max(0, Math.min(1, value)); return 1 - Math.pow(1 - p, 3); };
  const roundedRect = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); };
  function label(ctx, text, x, y, size, color, align = 'center', font = 'Inter, sans-serif') {
    ctx.fillStyle = color; ctx.font = `700 ${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(String(text).toUpperCase(), x, y, 800);
  }
  function arrow(ctx, x1, y1, x2, y2, color, width) {
    const angle = Math.atan2(y2 - y1, x2 - x1); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - width * 2.6 * Math.cos(angle - .55), y2 - width * 2.6 * Math.sin(angle - .55)); ctx.lineTo(x2 - width * 2.6 * Math.cos(angle + .55), y2 - width * 2.6 * Math.sin(angle + .55)); ctx.closePath(); ctx.fill();
  }
  function node(ctx, x, y, r, color, fill = true) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.strokeStyle = color; fill ? ctx.fill() : ctx.stroke();
  }
  function heart(ctx, x, y, size, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 100, size / 100); ctx.beginPath(); ctx.moveTo(0, 32); ctx.bezierCurveTo(-74, -15, -45, -65, 0, -28); ctx.bezierCurveTo(45, -65, 74, -15, 0, 32); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.restore();
  }
  function human(ctx, x, y, s, color, alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color; node(ctx, x, y - s * .34, s * .105, color);
    ctx.beginPath(); ctx.moveTo(x - s * .13, y - s * .2); ctx.quadraticCurveTo(x, y - s * .27, x + s * .13, y - s * .2); ctx.lineTo(x + s * .21, y + s * .18); ctx.quadraticCurveTo(x, y + s * .25, x - s * .21, y + s * .18); ctx.closePath(); ctx.fill();
    ctx.lineWidth = s * .055; ctx.lineCap = 'round'; ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(x - s * .1, y + s * .14); ctx.lineTo(x - s * .15, y + s * .46); ctx.moveTo(x + s * .1, y + s * .14); ctx.lineTo(x + s * .15, y + s * .46); ctx.stroke(); ctx.restore();
  }
  function leaf(ctx, x, y, w, h, color, rotation = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); ctx.beginPath(); ctx.ellipse(0, 0, w * .5, h * .5, 0, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha *= .55; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, w * .025); ctx.beginPath(); ctx.moveTo(-w * .36, h * .25); ctx.quadraticCurveTo(0, 0, w * .38, -h * .25); ctx.stroke(); ctx.restore();
  }

  function drawVisual(ctx, scene, box, progress, time, style) {
    const { x, y, w, h } = box; const p = ease(progress); const scale = Math.min(w, h); const accent = style.a; const second = style.b; const ink = style.ink; const sub = style.sub;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    // Three depth planes drift independently, so the art has camera-like parallax rather than a single moving diagram.
    ctx.globalAlpha = .13; ctx.fillStyle = second; node(ctx, x + w * (.74 + Math.sin(time * .18) * .018), y + h * .25 + Math.sin(time * .14) * h * .025, scale * .23, second);
    ctx.globalAlpha = .2; ctx.strokeStyle = accent; ctx.lineWidth = Math.max(1, scale * .003); ctx.beginPath(); ctx.ellipse(x + w * .45 + Math.sin(time * .22) * scale * .025, y + h * .52, w * .39, h * .4, -.12, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = .32 + .68 * p; ctx.translate(Math.sin(time * .35) * scale * .012, Math.cos(time * .3) * scale * .008);
    const title = scene.focus[0] || 'GAGASAN';
    if (scene.visual === 'sugar') {
      // Body silhouette, blood-flow ribbon, and animated glucose particles — an explicitly illustrative metaphor.
      const hx = x + w * .2, hy = y + h * .56, body = h * .55;
      ctx.globalAlpha = .22; human(ctx, hx, hy, body, accent, .7);
      ctx.globalAlpha = .88; ctx.strokeStyle = `${second}cc`; ctx.lineWidth = h * .075; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x + w * .35, y + h * .55); ctx.bezierCurveTo(x + w * .5, y + h * .28, x + w * .62, y + h * .83, x + w * .91, y + h * .47); ctx.stroke();
      ctx.globalAlpha = .95; heart(ctx, x + w * .31, y + h * .48, scale * .11, second);
      for (let i = 0; i < 7; i++) { const t = (p * .85 + i / 7) % 1; const px = x + w * (.39 + .48 * t); const py = y + h * (.52 + Math.sin(t * Math.PI * 2 + time * .45) * .1); ctx.save(); ctx.translate(px, py); ctx.rotate(time * .7 + i); const r = scale * .018; ctx.fillStyle = i % 2 ? accent : '#fff0b3'; roundedRect(ctx, -r, -r, r * 2, r * 2, r * .18); ctx.fill(); ctx.restore(); }
      label(ctx, 'ILUSTRASI · GULA & ENERGI', x + w * .61, y + h * .84, Math.max(12, scale * .035), ink, 'center', style.font);
      label(ctx, title, x + w * .62, y + h * .25, Math.max(14, scale * .058), accent);
    } else if (scene.visual === 'body') {
      const cx = x + w * .31, cy = y + h * .55; human(ctx, cx, cy, h * .78, `${accent}cc`, .85);
      heart(ctx, cx, cy - h * .02, h * .19, second);
      ctx.strokeStyle = accent; ctx.lineWidth = Math.max(2, h * .014); ctx.beginPath(); ctx.moveTo(x + w * .51, cy); const pulse = [0,.0,.2,-.24,.44,-.49,.14,0,0,0]; pulse.forEach((v,i)=>ctx.lineTo(x+w*(.52+i*.047),cy+v*h)); ctx.stroke();
      node(ctx, x + w * (.73 + Math.sin(time * .65) * .02), cy, h * .17, `${second}44`, false);
      label(ctx, title, x + w * .73, cy, Math.max(14, scale * .06), ink);
      label(ctx, 'SKEMA ANATOMI ILUSTRATIF', x + w * .7, y + h * .86, Math.max(11, scale * .027), sub);
    } else if (scene.visual === 'food') {
      const cx = x + w * .34, cy = y + h * .53, r = h * .35;
      ctx.fillStyle = `${accent}30`; node(ctx, cx, cy + h * .08, r * 1.18, `${accent}30`); ctx.strokeStyle = ink; ctx.lineWidth = h * .02; node(ctx, cx, cy, r, `${ink}cc`, false);
      ctx.fillStyle = accent; ctx.beginPath(); ctx.ellipse(cx-r*.27,cy,r*.26,r*.19,-.25,0,Math.PI*2); ctx.fill(); leaf(ctx,cx-r*.14,cy-r*.22,r*.16,r*.08,second,-.5);
      ctx.fillStyle = second; ctx.beginPath(); ctx.arc(cx+r*.32,cy-r*.14,r*.16,0,Math.PI*2); ctx.fill(); ctx.fillStyle = `${accent}cc`; roundedRect(ctx,cx+r*.12,cy+r*.19,r*.3,r*.26,r*.03); ctx.fill();
      for (let i=0;i<4;i++) { const tx=x+w*(.65+i*.075), ty=y+h*(.25+(i%2)*.36); leaf(ctx,tx,ty,h*.18,h*.11,i%2?accent:second,time*.16+i*.6); }
      label(ctx, title, x+w*.68, y+h*.77, Math.max(14,scale*.05), ink);
      label(ctx, 'KEBIASAAN · PILIHAN · PORSI', x+w*.68, y+h*.91, Math.max(10,scale*.024), sub);
    } else if (scene.visual === 'nature') {
      // Layered landscape, water, vegetation and sun with independent depth motion.
      const drift = Math.sin(time * .18) * w * .025;
      ctx.fillStyle = `${second}74`; ctx.beginPath(); ctx.moveTo(x,y+h*.72); ctx.lineTo(x+w*.2+drift,y+h*.28); ctx.lineTo(x+w*.43,y+h*.72); ctx.lineTo(x+w*.62-drift,y+h*.38); ctx.lineTo(x+w*.91,y+h*.72); ctx.lineTo(x+w,y+h*.6); ctx.lineTo(x+w,y+h); ctx.lineTo(x,y+h); ctx.fill();
      ctx.fillStyle = `${accent}72`; ctx.beginPath(); ctx.moveTo(x,y+h*.72); ctx.quadraticCurveTo(x+w*.32,y+h*.57,x+w*.56,y+h*.72); ctx.quadraticCurveTo(x+w*.82,y+h*.89,x+w,y+h*.65); ctx.lineTo(x+w,y+h); ctx.lineTo(x,y+h); ctx.fill();
      const sunX=x+w*(.76+Math.sin(time*.14)*.018); ctx.globalAlpha=.82; node(ctx,sunX,y+h*.26,h*.12,accent);
      for(let i=0;i<4;i++){const tx=x+w*(.12+i*.19),ty=y+h*(.73+(i%2)*.08); leaf(ctx,tx,ty,h*.18,h*.09,i%2?accent:second,-.5+i*.22);}
      label(ctx,title,x+w*.7,y+h*.56,Math.max(13,scale*.046),ink);
    } else if (scene.visual === 'tech') {
      const dx=x+w*.3,dy=y+h*.53, phoneW=w*.24, phoneH=h*.78;
      ctx.fillStyle=`${accent}26`; roundedRect(ctx,dx-phoneW*.6,dy-phoneH*.5,phoneW*1.2,phoneH,phoneW*.13); ctx.fill(); ctx.strokeStyle=accent; ctx.lineWidth=Math.max(2,scale*.007); ctx.stroke();
      ctx.fillStyle=`${second}44`; roundedRect(ctx,dx-phoneW*.46,dy-phoneH*.37,phoneW*.92,phoneH*.68,phoneW*.06); ctx.fill();
      for(let i=0;i<5;i++){const nx=x+w*(.59+(i%2)*.24),ny=y+h*(.25+i*.13); ctx.strokeStyle=`${accent}99`;ctx.lineWidth=Math.max(1,scale*.003);ctx.beginPath();ctx.moveTo(dx+phoneW*.6,dy-phoneH*.18);ctx.lineTo(nx,ny);ctx.stroke();node(ctx,nx,ny,scale*.018,i%2?second:accent);}
      label(ctx,title,x+w*.76,y+h*.87,Math.max(12,scale*.043),ink);
    } else if (scene.visual === 'life') {
      // A layered neighbourhood and people, not product-card UI.
      const ground=y+h*.77; ctx.fillStyle=`${second}50`; ctx.fillRect(x,ground,w,h*.25);
      for(let i=0;i<5;i++){const bx=x+w*(.06+i*.18),bh=h*(.27+(i%3)*.1);ctx.fillStyle=i%2?`${accent}aa`:`${second}aa`;roundedRect(ctx,bx,ground-bh,w*.13,bh,w*.012);ctx.fill();for(let r=0;r<3;r++)for(let c=0;c<2;c++){ctx.fillStyle=`${style.bg}bb`;ctx.fillRect(bx+w*(.025+c*.052),ground-bh+h*(.045+r*.066),w*.022,h*.025);}}
      for(let i=0;i<4;i++)human(ctx,x+w*(.2+i*.2),ground-h*.05,h*.31,i%2?ink:accent,.9);
      label(ctx,title,x+w*.52,y+h*.2,Math.max(14,scale*.052),ink);
      label(ctx,scene.focus.slice(1,3).join(' · ')||'ORANG · TEMPAT · WAKTU',x+w*.52,y+h*.36,Math.max(10,scale*.027),sub);
    } else if (scene.visual === 'time') {
      const cy=y+h*.58; ctx.strokeStyle=`${accent}aa`;ctx.lineWidth=Math.max(3,scale*.009);ctx.beginPath();ctx.moveTo(x+w*.1,cy);ctx.lineTo(x+w*.9,cy);ctx.stroke();
      const labels=scene.focus.slice(0,3);for(let i=0;i<3;i++){const t=(i+1)/4, nx=x+w*(.1+.8*t), enter=ease((p-i*.16)/.28);node(ctx,nx,cy,scale*(.022+.016*enter),i===1?second:accent);ctx.globalAlpha=enter;label(ctx,labels[i]||['AWAL','PERUBAHAN','KINI'][i],nx,cy-h*.23,Math.max(11,scale*.032),ink);ctx.globalAlpha=1;}
      ctx.globalAlpha=.8;for(let i=0;i<6;i++){const xx=x+w*(.12+i*.13), yy=y+h*(.82+Math.sin(i+time*.35)*.035);ctx.fillStyle=i%2?`${second}88`:`${accent}88`;ctx.fillRect(xx,yy,w*.055,h*.08);}
    } else if (scene.visual === 'cause' || scene.visual === 'process' || scene.visual === 'compare') {
      const labels=scene.focus.length?scene.focus:['IDE','DAMPAK'];const count=scene.visual==='compare'?2:3;const baseY=y+h*.54;
      if(scene.visual==='compare'){ctx.strokeStyle=`${accent}66`;ctx.lineWidth=Math.max(1,scale*.003);ctx.beginPath();ctx.moveTo(x+w*.5,y+h*.18);ctx.lineTo(x+w*.5,y+h*.88);ctx.stroke();}
      for(let i=0;i<count;i++){const enter=ease((p-i*.13)/.28);const bx=x+w*(.18+i*(scene.visual==='compare'?.64:.32));const yy=baseY+(1-enter)*h*.12+Math.sin(time*.9+i)*h*.012;const r=scale*.13;
        if(i<count-1 && scene.visual!=='compare') arrow(ctx,bx+r*.8,yy,bx+w*.32-r*.9,yy,second,Math.max(2,scale*.008));
        ctx.globalAlpha=enter;ctx.fillStyle=`${i===1?second:accent}30`;node(ctx,bx,yy,r,`${i===1?second:accent}99`,false);ctx.fillStyle=`${style.bg}55`;node(ctx,bx,yy,r*.72,`${i===1?second:accent}34`);label(ctx,labels[i]||['KONTEKS','PERUBAHAN','DAMPAK'][i],bx,yy,Math.max(10,scale*.026),ink);ctx.globalAlpha=1;
      }
      label(ctx,scene.visual==='cause'?'HUBUNGAN KONSEP':scene.visual==='compare'?'DUA SISI · TANPA SKALA DATA':'URUTAN DALAM NARASI',x+w*.5,y+h*.91,Math.max(10,scale*.025),sub);
    } else {
      // A documentary title-card illustration: typography acts as the subject, with moving sketch lines.
      const cx=x+w*.5,cy=y+h*.52;ctx.globalAlpha=.17;ctx.strokeStyle=accent;ctx.lineWidth=Math.max(2,scale*.008);
      for(let i=0;i<5;i++){ctx.beginPath();ctx.arc(cx,cy,scale*(.12+i*.075)+Math.sin(time*.4+i)*scale*.008,0,Math.PI*2);ctx.stroke();}
      ctx.globalAlpha=.95;ctx.save();ctx.translate(cx,cy);ctx.rotate(Math.sin(time*.22)*.025);ctx.font=`900 ${Math.max(18,Math.min(scale*.1,w*.14))}px ${style.font}, Inter, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=ink;ctx.fillText(title.toUpperCase().slice(0,20),0,0,w*.76);ctx.restore();
      const f=scene.focus.slice(1,3);f.forEach((word,i)=>{const angle=time*.25+i*Math.PI;const px=cx+Math.cos(angle)*w*.36,py=cy+Math.sin(angle)*h*.31;node(ctx,px,py,scale*.017,i?second:accent);label(ctx,word,px,py-h*.065,Math.max(9,scale*.021),sub);});
    }
    // Fine grain-like scan strokes and foreground flecks move at a faster depth for a cinematic finish.
    ctx.globalAlpha=.13;ctx.strokeStyle=accent;ctx.lineWidth=Math.max(1,scale*.002);ctx.beginPath();ctx.moveTo(x+w*.04,y+h*.95);ctx.lineTo(x+w*(.28+Math.sin(time*.7)*.02),y+h*.93);ctx.moveTo(x+w*.72,y+h*.08);ctx.lineTo(x+w*.95,y+h*.08);ctx.stroke();
    ctx.restore();
  }

  function activeWordIndex(scene, absoluteTime) {
    const timings = scene.wordTimings || [];
    const index = timings.findIndex((item) => absoluteTime >= item.start && absoluteTime < item.end);
    return index < 0 ? Math.max(0, timings.length - 1) : index;
  }

  function drawKineticCaption(ctx, scene, absoluteTime, x, y, width, height, fontSize, style, mode) {
    const words = scene.words || tokens(scene.sentence); if (!words.length) return;
    const active = activeWordIndex(scene, absoluteTime);
    const windowStart = Math.max(0, Math.min(active - 2, words.length - 7));
    const selected = (mode === 'full' ? words : words.slice(windowStart, windowStart + 7)).map((word, index) => ({ word, index: mode === 'full' ? index : windowStart + index }));
    ctx.save();ctx.font=`600 ${fontSize}px Inter, sans-serif`;ctx.textBaseline='middle';
    const maxWidth=width*.92, gap=fontSize*.38, lines=[[]];let line=0, lineWidth=0;
    selected.forEach(({word,index:wordIndex})=>{const w=ctx.measureText(word).width;const needed=(lines[line].length?gap:0)+w;if(lineWidth+needed>maxWidth&&line<2){line++;lines[line]=[];lineWidth=0;}lines[line].push({word,index:wordIndex,width:w});lineWidth+=(lines[line].length>1?gap:0)+w;});
    const lineGap=Math.min(fontSize*1.52,height*.37);const top=y+height/2-(lines.length-1)*lineGap/2;
    lines.forEach((row,rowIndex)=>{const total=row.reduce((sum,item)=>sum+item.width,0)+gap*Math.max(0,row.length-1);let left=x+(width-total)/2;row.forEach((item)=>{const isActive=item.index===active;const wave=isActive?Math.sin(absoluteTime*18)*fontSize*.035:0;if(isActive){ctx.fillStyle=style.a;roundedRect(ctx,left-fontSize*.18,top+rowIndex*lineGap-fontSize*.52-wave,item.width+fontSize*.36,fontSize*1.04,fontSize*.22);ctx.fill();ctx.fillStyle=style.bg;}else ctx.fillStyle=mode==='full'?style.ink:`${style.ink}bd`;ctx.textAlign='left';ctx.fillText(item.word,left,top+rowIndex*lineGap-wave);left+=item.width+gap;});});
    ctx.restore();
  }

  function drawTransition(ctx, localTime, width, height, style) {
    const p=Math.max(0,1-localTime/.42);if(p<=0)return;const progress=ease(p);ctx.save();ctx.globalAlpha=.18*progress;ctx.fillStyle=style.b;ctx.beginPath();ctx.moveTo(width*(1-progress)-width*.1,0);ctx.lineTo(width*(1-progress)+width*.25,0);ctx.lineTo(width*(1-progress)+width*.05,height);ctx.lineTo(width*(1-progress)-width*.3,height);ctx.closePath();ctx.fill();ctx.globalAlpha=.75*progress;ctx.strokeStyle=style.a;ctx.lineWidth=Math.max(2,width*.004);ctx.beginPath();ctx.moveTo(width*(1-progress)+width*.25,0);ctx.lineTo(width*(1-progress)+width*.05,height);ctx.stroke();ctx.restore();
  }

  window.AutoMotionNarrative = { splitText, focusWords, classify, buildScenes, syncTimings, drawVisual, drawKineticCaption, drawTransition, activeWordIndex, visualName: (key) => NAMES[key] || NAMES.concept };
})();
