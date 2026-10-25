// Preset genre AI Song Cover Studio.
// Kategori: rock-metal | pop-edm | hip-hop | urban | jazz | asia | dunia | klasik
// Prompt tiap genre dirancang menjelaskan aransemen + vibe dalam satu kalimat.
export type SongGenreCategory = 'rock-metal' | 'pop-edm' | 'hip-hop' | 'urban' | 'jazz' | 'asia' | 'dunia' | 'klasik'

export interface SongGenrePreset {
  id: string
  label: string
  cat: SongGenreCategory
  prompt: string
}

export const GENRE_CATEGORIES: Array<{ id: SongGenreCategory | 'all'; label: string }> = [
  { id: 'all', label: 'Semua' },
  { id: 'rock-metal', label: '🎸🤘 Rock & Metal' },
  { id: 'pop-edm', label: '🎛️✨ EDM & Elektronik' },
  { id: 'hip-hop', label: '🔥 Hip-Hop & Internet' },
  { id: 'urban', label: '💃 R&B, Urban & Worldbeat' },
  { id: 'jazz', label: '🎷 Jazz & Blues' },
  { id: 'asia', label: '🌏 Indonesia & Asia' },
  { id: 'dunia', label: '🌍 Dunia & Tradisional' },
  { id: 'klasik', label: '🎻 Klasik & Sinematik' },
]

export const STYLE_PRESETS: SongGenrePreset[] = [
  // ── Rock & Metal ─────────────────────────────────────────────
  { id: 'rock', label: '🎸 Rock', cat: 'rock-metal', prompt: 'Energetic rock cover, distorted electric guitars, driving drums, powerful bass, anthemic chorus, raw live band energy, studio quality.' },
  { id: 'classic-rock', label: '🎸 Classic Rock', cat: 'rock-metal', prompt: 'Classic rock cover, crunchy tube-amp guitars, bass-heavy 4/4 groove, Hammond organ, gritty vocals, 70s stadium anthemic vibe, studio quality.' },
  { id: 'hard-rock', label: '⚡ Hard Rock', cat: 'rock-metal', prompt: 'Hard rock cover, thick downtuned riffs, punchy gated drums, soaring lead guitar, powerful belting vocal, chest-thumping groove, studio quality.' },
  { id: 'punk-rock', label: '✊ Punk Rock', cat: 'rock-metal', prompt: 'Punk rock cover, fast downpicked palm-muted guitar, three-chord blasts, tight snappy drums, bratty snarling vocal, garage raw energy, studio quality.' },
  { id: 'pop-punk', label: '🛹 Pop Punk', cat: 'rock-metal', prompt: 'Pop punk cover, bright buzzing guitar riff, fast driving drums, singalong catchy chorus, nostalgic early-2000s energy, studio quality.' },
  { id: 'alt-rock', label: '📻 Alternative Rock', cat: 'rock-metal', prompt: 'Alternative rock cover, atmospheric overdriven guitar, dynamic quiet-loud arrangement, melodic bassline, emotive raw vocal, 90s vibe, studio quality.' },
  { id: 'indie-rock', label: '🧢 Indie Rock', cat: 'rock-metal', prompt: 'Indie rock cover, jangly clean electric guitar, groovy bass, tape-saturated drums, casual warm vocal, charming lo-fi polish, studio quality.' },
  { id: 'grunge', label: '🌫️ Grunge', cat: 'rock-metal', prompt: 'Grunge cover, sludgy distorted guitars, heavy dynamic swings, sparse drums, raspy angsty vocal, dirty 90s Seattle vibe, studio quality.' },
  { id: 'post-rock', label: '🌊 Post-Rock', cat: 'rock-metal', prompt: 'Post-rock cover, reverb-drenched guitar swells, cinematic slow build from quiet to triumphant crescendo, layered textures, instrumental drums, studio quality.' },
  { id: 'shoegaze', label: '👟 Shoegaze', cat: 'rock-metal', prompt: 'Shoegaze cover, walls of washed reverb and tremolo guitar, blurred dreamy vocals buried in haze, swirling distortion textures, ethereal vibe, studio quality.' },
  { id: 'dream-pop', label: '☁️ Dream Pop', cat: 'rock-metal', prompt: 'Dream pop cover, airy reverb guitars, glittering pads, soft steady drums, breathy angelic vocals, weightless nostalgic haze, studio quality.' },
  { id: 'math-rock', label: '🧮 Math Rock', cat: 'rock-metal', prompt: 'Math rock cover, clean tapping riffs in odd time signatures, twinkly interlocking guitar parts, syncopated technical drums, complex but melodic, studio quality.' },
  { id: 'post-hardcore', label: '🎭 Post-Hardcore', cat: 'rock-metal', prompt: 'Post-hardcore cover, sharp punchy riffs, aggressive verses with screams, huge melodic sung chorus, breakdown energy, dramatic dynamics, studio quality.' },
  { id: 'gothic-rock', label: '🦇 Gothic Rock / Post-Punk', cat: 'rock-metal', prompt: 'Gothic rock cover, chorus-drenched bass-forward guitars, brooding coldwave synths, propulsive drums, dark baritone vocal, moody 80s atmosphere, studio quality.' },
  { id: 'emo', label: '🖤 Emo / Midwest Emo', cat: 'rock-metal', prompt: 'Midwest emo cover, twinkly fast arpeggiated guitar, chaotic cathartic drum fills, strained heartfelt vocals, raw confessional energy, studio quality.' },
  { id: 'stoner-rock', label: '🪨 Stoner Rock / Desert Rock', cat: 'rock-metal', prompt: 'Stoner desert rock cover, fat fuzzy low riffs, hazy fuzz pedals, laid-back heavy groove, spacey psychedelic atmosphere, dusty and rumbling, studio quality.' },
  { id: 'ska-punk', label: '🎺 Ska Punk', cat: 'rock-metal', prompt: 'Ska punk cover, upstroke offbeat guitar, bright brass section, bouncing bassline, fast punk second half, energetic party vibe, studio quality.' },
  { id: 'heavy-metal', label: '🤘 Heavy Metal', cat: 'rock-metal', prompt: 'Heavy metal cover, downtuned distorted guitars, double-kick drums, aggressive powerful delivery, epic guitar solo, studio quality.' },
  { id: 'thrash-metal', label: '💀 Thrash Metal', cat: 'rock-metal', prompt: 'Thrash metal cover, relentless fast riffing, galloping double bass drums, snarling aggressive vocal, mosh-inducing speed, raw 80s production, studio quality.' },
  { id: 'death-metal', label: '☠️ Death Metal', cat: 'rock-metal', prompt: 'Death metal cover, brutal, deep guttural vocals, blast beats, chaotic technical riffs, sinister atmosphere, relentless aggression, studio quality.' },
  { id: 'black-metal', label: '🌑 Black Metal', cat: 'rock-metal', prompt: 'Black metal cover, treble-heavy tremolo riffs, relentless blast beats, harsh shrieking vocal, cold icy atmosphere, lo-fi raw production, studio quality.' },
  { id: 'nu-metal', label: '🧢 Nu Metal', cat: 'rock-metal', prompt: 'Nu metal cover, groovy downtuned 7-string riffs, slap bass accents, electronic textures, punchy drums, angsty rhythmic rap-rock vocal, studio quality.' },
  { id: 'prog-metal', label: '🔬 Progressive Metal', cat: 'rock-metal', prompt: 'Progressive metal cover, complex shifting time signatures, searing clean leads, heavy syncopated riffs with atmospheric clean-passages, virtuosic dynamics, studio quality.' },
  { id: 'metalcore', label: '⚙️ Modern Metalcore', cat: 'rock-metal', prompt: 'Modern metalcore cover, polyrhythmic drop riffs, symphonic synths, harsh screams verses, huge clean soaring chorus, bone-crushing breakdown, studio quality.' },
  { id: 'djent', label: '🎛️ Djent', cat: 'rock-metal', prompt: 'Djent cover, percussive high-gain extended-range chugs, polymetric tight riffs, ambient clean interludes, glitchy electronic textures, surgical modern mix, studio quality.' },
  { id: 'thall', label: '⚡ Thall', cat: 'rock-metal', prompt: 'Thall cover, downtuned sludgy hyper-groovy mid-tempo chugs, cavernous toms, dark atmospheric pads, guttural vocals, crushing weight, studio quality.' },
  { id: 'prog-death', label: '🌌 Progressive Death Metal', cat: 'rock-metal', prompt: 'Progressive death metal cover, technical odd-time riffs, brutal guttural vocals, sweeping leads, atmospheric keys, cosmic punishing precision, studio quality.' },
  { id: 'symphonic-metal', label: '👑 Symphonic Metal', cat: 'rock-metal', prompt: 'Symphonic metal cover, full orchestral backing, operatic female lead over heavy riffs, epic choir layers, dramatic cinematic build, studio quality.' },
  { id: 'doom-metal', label: '🕯️ Doom Metal', cat: 'rock-metal', prompt: 'Doom metal cover, massive slow-motion riffs, weighty sparse drums, mournful vocals, funeral pace, brooding melancholic atmosphere, studio quality.' },
  { id: 'folk-metal', label: '🪗 Folk Metal', cat: 'rock-metal', prompt: 'Folk metal cover, heavy guitars with folk instruments: bagpipes, whistles, hurdy gurdy and fiddles, rousing tavern chorus, battle-worn energy, studio quality.' },
  { id: 'power-metal', label: '⚔️ Power Metal', cat: 'rock-metal', prompt: 'Power metal cover, blazing fast double-kick drums, heroic uplifting guitar harmonies, operatic steel-vocal drama, epic fantasy battle energy, studio quality.' },
  { id: 'deathcore', label: '💥 Deathcore', cat: 'rock-metal', prompt: 'Deathcore cover, slam-heavy low-tuned breakdowns, guttural pig squeals, blackened tremolo sections, blast beats, punishing modern heaviness, studio quality.' },
  { id: 'viking-metal', label: '🛡️ Pagan / Viking Metal', cat: 'rock-metal', prompt: 'Pagan viking metal cover, heavy riffs with folk melodies, war chants, echoing drums, shamanic atmosphere, raw battle spirit, studio quality.' },

  // ── EDM & Elektronik ──────────────────────────────────────────
  { id: 'edm', label: '🎛️ EDM', cat: 'pop-edm', prompt: 'Festival EDM cover, big supersaw lead, four-on-the-floor kick, build-ups and drops, energetic club energy, studio quality.' },
  { id: 'house', label: '🏠 Deep House', cat: 'pop-edm', prompt: 'Deep house cover, groovy four-on-the-floor beat, warm sub bass, lush pads, plucked synths, hypnotic groove, club vibe, studio quality.' },
  { id: 'techno', label: '🤖 Techno', cat: 'pop-edm', prompt: 'Techno cover, relentless industrial four-on-the-floor kick, dark acid modulations, cavernous reverb, hypnotic machine groove, warehouse vibe, studio quality.' },
  { id: 'melodic-techno', label: '🌌 Melodic Techno', cat: 'pop-edm', prompt: 'Melodic techno cover, steady pulsing kick, evolving analog arpeggios, emotional cinematic pads, hypnotic build to euphoria, dark sleek atmosphere, studio quality.' },
  { id: 'tech-house', label: '🕺 Tech House Modern', cat: 'pop-edm', prompt: 'Modern tech house cover, rolling bouncy bassline, crisp shakers, filtered vocal chops, groovy minimal drums, sweaty club groove, studio quality.' },
  { id: 'slap-house', label: '🖐️ Slap House', cat: 'pop-edm', prompt: 'Slap house cover, slap bass punchy pluck lead, clean four-on-the-floor groove, glossy melodic top-line, modern Brazilian bass vibe, studio quality.' },
  { id: 'bass-house', label: '🔊 Bass House', cat: 'pop-edm', prompt: 'Bass house cover, heavy wobbly bassline punch, half-time drums with four-to-the-floor, gritty talk box, aggressive drop energy, studio quality.' },
  { id: 'trance', label: '💫 Trance', cat: 'pop-edm', prompt: 'Trance cover, soaring euphoric supersaw melodies, pounding plucked bassline, epic breakdown build, transcendental rave energy, studio quality.' },
  { id: 'dubstep', label: '🌊 Dubstep', cat: 'pop-edm', prompt: 'Dubstep cover, aggressive growling wobble bass, half-time drums with punchy snares, talk-box stabs, calm intro into massive drop, studio quality.' },
  { id: 'color-bass', label: '🎨 Color Bass / Melodic Riddim', cat: 'pop-edm', prompt: 'Color bass cover, melodic lead into vibrant wobbling riddim drops, evolving metallic synth textures, playful heavy bpm groove, studio quality.' },
  { id: 'dnb', label: '⚡ Drum & Bass', cat: 'pop-edm', prompt: 'Drum and bass cover, breakneck syncopated Amen drums, deep rolling sub bass, airy pads, rushing adrenaline energy, studio quality.' },
  { id: 'trap-edm', label: '🐍 Trap (EDM)', cat: 'pop-edm', prompt: 'Festival trap cover, booming 808 glides, blaring distorted brass lead, pitched vocal chops, massive half-time drop, trap EDM swagger, studio quality.' },
  { id: 'future-bass', label: '🌈 Future Bass', cat: 'pop-edm', prompt: 'Future bass cover, wailing sidechained supersaw melodies, pitched vocal chops, rippling 808 kicks, dreamy ethereal atmosphere, studio quality.' },
  { id: 'hardstyle', label: '🥾 Hardstyle', cat: 'pop-edm', prompt: 'Hardstyle cover, distorted reverse-bass kicks, pumping energetic leads, big euphoric build, stomping hard dance energy, studio quality.' },
  { id: 'industrial', label: '🏭 Industrial', cat: 'pop-edm', prompt: 'Industrial cover, pounding metallic drums, grinding distorted synths, angsty machine vocals, dirty cold factory atmosphere, studio quality.' },
  { id: 'ukg', label: '🇬🇧 UK Garage (UKG)', cat: 'pop-edm', prompt: 'UK garage cover, shuffled 2-step drums, deep wobbling bassline, pitched vocal hooks, skippy syncopated groove, ravy London vibe, studio quality.' },
  { id: 'breakcore', label: '⚙️ Breakcore', cat: 'pop-edm', prompt: 'Breakcore cover, frantic chopped Amen breaks at high bpm, glitchy sample manipulation, chaotic emotional sweeps, raw internet vitality, studio quality.' },
  { id: 'witch-house', label: '🕸️ Witch House', cat: 'pop-edm', prompt: 'Witch house cover, slowed murky 808 drums, eerie chopped vocals, dark haunted pads, occult trap-electronic haze, studio quality.' },
  { id: 'jersey-club', label: '🧦 Jersey Club', cat: 'pop-edm', prompt: 'Jersey club cover, signature bed-squeak triplet drums, chopped vocal barks and hooks, bouncy energetic groove, playful club energy, studio quality.' },
  { id: 'synthwave', label: '🎹 Synthwave / Retrowave', cat: 'pop-edm', prompt: 'Synthwave cover, retro analog synths, punchy gated drums, arpeggios, nostalgic neon 80s vibe, studio quality.' },
  { id: 'vaporwave', label: '🗿 Vaporwave', cat: 'pop-edm', prompt: 'Vaporwave cover, slowed nostalgic saxophone samples, dreamy washed-out synths, hollow reverb, bittersweet commercial-80s melancholy, studio quality.' },
  { id: 'chillwave', label: '🌅 Chillwave / Glo-Fi', cat: 'pop-edm', prompt: 'Chillwave cover, hazy synth washes, soft tape-worn drums, mellow dreamy vocals, washed summer afternoon feel, studio quality.' },
  { id: 'future-funk', label: '🪩 Future Funk', cat: 'pop-edm', prompt: 'Future funk cover, bright filtered disco guitar, chopped funky vocal hooks, four-on-the-floor groove, glossy French house vibe, studio quality.' },
  { id: 'electro-swing', label: '🎩 Electro Swing', cat: 'pop-edm', prompt: 'Electro swing cover, vintage big-band brass loops over modern house beats, scratched vinyl textures, playful roaring 20s party vibe, studio quality.' },
  { id: 'electro-pop', label: '⚡ Electro Pop', cat: 'pop-edm', prompt: 'Electro pop cover, crisp punchy synth layering, glossy vocal processing, four-on-the-floor pulse, modern sleek production, studio quality.' },
  { id: 'chiptune', label: '👾 Nintendocore / Modern Chiptune', cat: 'pop-edm', prompt: 'Nintendocore cover, driving 8-bit chiptune lead synced with heavy modern guitars/breakdowns, synthesised game console drums, energetic playful chaos, studio quality.' },
  { id: 'hyperpop', label: '🍬 Hyperpop', cat: 'pop-edm', prompt: 'Hyperpop cover, glitchy maximalist synth cacophony, pitched chipmunk vocals, distorted 808 bass, chaotic bright sugary energy, studio quality.' },
  { id: 'digicore', label: '💻 Digicore', cat: 'pop-edm', prompt: 'Digicore cover, intricate digital synth layers, hyperpop-adjacent vocal chops, syncopated club percussion, raw online core energy, studio quality.' },
  { id: 'dariacore', label: '🔥 Dariacore / Scenecore Modern', cat: 'pop-edm', prompt: 'Dariacore cover, hyper-fast meme sample chops, aggressive 808 blasts, frantic breakbeat chaos, theatrical online scenecore energy, studio quality.' },
  { id: 'gorewave', label: '🩸 Gorewave / Synth-Gore', cat: 'pop-edm', prompt: 'Gorewave cover, sinister detuned horror synths, heavy distorted retribution drums, slasher-film atmosphere, dark dripping dread, studio quality.' },

  // ── Hip-Hop & Internet ────────────────────────────────────────
  { id: 'hiphop', label: '🔥 Hip-Hop', cat: 'hip-hop', prompt: 'Hip-hop cover, boom-bap or trap beat, deep 808 bass, punchy drums, rhythmic delivery, confident vibe, studio quality.' },
  { id: 'plugg', label: '💎 PluggnB / Plugg', cat: 'hip-hop', prompt: 'Plugg cover, twinkly plugg bell melodies, sliding punchy 808s, chill bap drums, dreamy melodic rap flow, atmospheric lo-fi bounce, studio quality.' },
  { id: 'boom-bap', label: '📻 Boom Bap', cat: 'hip-hop', prompt: 'Boom bap cover, dusty sampled drums, deep upright bassline, jazzy piano/toasting stabs, raw gritty vocal delivery, golden era 90s vibe, studio quality.' },
  { id: 'trap', label: '🐍 Trap (Hip-Hop)', cat: 'hip-hop', prompt: 'Trap cover, booming 808 basslines, icy hi-hat rolls, eerie synth stabs, melodic auto-tuned flow Atlanta energy, studio quality.' },
  { id: 'drill', label: '🗡️ Drill', cat: 'hip-hop', prompt: 'Drill cover, sliding sub-bass 808s, sparse menacing dark keys, tense string stabs, hard-hitting UK/Chicago delivery, gritty cold energy, studio quality.' },
  { id: 'grime', label: '🇬🇧 Grime', cat: 'hip-hop', prompt: 'Grime cover, skittering eski beat, icy merk synth stabs, deep bass hits, rapid double-time spitting, raw East London energy, studio quality.' },
  { id: 'phonk', label: '🚬 Phonk', cat: 'hip-hop', prompt: 'Phonk cover, distorted cowbell melody, heavy Memphis 808 bass, pitched-up chopped vocals, mean drifting drift-car swagger, gritty raw Memphis texture, studio quality.' },
  { id: 'cloud-rap', label: '☁️ Cloud Rap', cat: 'hip-hop', prompt: 'Cloud rap cover, dreamy ambient pads, slow languid hi-hats, deep 808 thump, floating dazed flow, ethereal late-night haze, studio quality.' },
  { id: 'emo-rap', label: '💔 Emo Rap / Sad Boy Rap', cat: 'hip-hop', prompt: 'Emo rap cover, melancholic acoustic/piano samples, mellow 808 support, raw croaky emotional delivery, heartbroken late-night vibe, studio quality.' },

  // ── Urban & Worldbeat ─────────────────────────────────────────
  { id: 'rnb', label: '💜 R&B / Contemporary R&B', cat: 'urban', prompt: 'Smooth contemporary R&B cover, laid-back groove, lush chords, subtle trap hi-hats, silky harmonies, late night vibe, studio quality.' },
  { id: 'alt-rnb', label: '🌃 Alternative R&B', cat: 'urban', prompt: 'Alternative R&B cover, moody atmospheric production, sparse trap-influenced drums, deep sub bass, airy falsetto harmonies, experimental late-night texture, studio quality.' },
  { id: 'rnb-90s', label: '📼 90s R&B', cat: 'urban', prompt: '90s R&B cover, smooth new jack swing groove, warm analog keys, tight harmonies, silky lead vocal runs, nostalgic slow-jam energy, studio quality.' },
  { id: 'neo-soul', label: '🧡 Neo-Soul', cat: 'urban', prompt: 'Neo soul cover, buttery electric piano chords, walking bassline, brush drums, velvety rich vocal with melisma, warm sophisticated groove, studio quality.' },
  { id: 'funk', label: '🕺 Funk', cat: 'urban', prompt: 'Funk cover, punchy slap bass, tight rhythmic guitar scratching, four-on-the-floor drums with brass stabs, flamboyant party energy, studio quality.' },
  { id: 'soul', label: '🎤 Soul', cat: 'urban', prompt: 'Soul cover, driving Motown backbeat, rich brass section, deep bass, gospel-tinged organ, warm emotive church-rooted vocal, heartfelt vintage energy, studio quality.' },
  { id: 'latin-trap', label: '🌶️ Latin Trap', cat: 'urban', prompt: 'Latin trap cover, dembow-paced 808 punch, syncopated hi-hats, dark keys, confident Spanish flow, exotic late-night club vibe, studio quality.' },
  { id: 'reggaeton', label: '🔥 Reggaeton Modern', cat: 'urban', prompt: 'Reggaeton modern cover, rolling dembow drum groove, punchy 808 bass, synthy perreo hook, flirtatious dance energy, sleek production, studio quality.' },
  { id: 'dancehall', label: '🏝️ Dancehall', cat: 'urban', prompt: 'Dancehall cover, punchy rolling bubble groove, heavy sub bass, brass stabs, laid-back Jamaican Patois chant, sweaty tropical club energy, studio quality.' },
  { id: 'amapiano', label: '🎹 Amapiano', cat: 'urban', prompt: 'Amapiano cover, signature log percussion, deep rolling piano chords, smooth shakers, laid-back groovy bounce, lavish South African house vibe, studio quality.' },
  { id: 'afrobeats', label: '🌍 Afrobeats / Afro-Fusion', cat: 'urban', prompt: 'Afrobeats cover, syncopated percussion and bells, muted guitar lines, groovy punchy bass, silky melodic flow, uplifting West African flavor, studio quality.' },

  // ── Jazz & Blues ──────────────────────────────────────────────
  { id: 'jazz', label: '🎷 Jazz', cat: 'jazz', prompt: 'Smooth jazz cover, upright bass, brush drums, soft piano comping, saxophone lead, warm lounge vibe, sophisticated and intimate, studio quality.' },
  { id: 'swing', label: '🎩 Swing / Big Band', cat: 'jazz', prompt: 'Big band swing cover, roaring brass section, walking bass, four-beat swing drums, vintage crooning vocal, toe-tapping 1930s energy, studio quality.' },
  { id: 'bebop', label: '🐝 Bebop', cat: 'jazz', prompt: 'Bebop jazz cover, lightning bebop saxophone line, spry piano comping, upright bass walking, fast swinging ride cymbal, virtuosic improvisational energy, studio quality.' },
  { id: 'hard-bop', label: '🍳 Hard Bop', cat: 'jazz', prompt: 'Hard bop jazz cover, gospel-tinged piano, groovy blues bass, bluesy trumpet stabs, soulful mid-tempo 60s lineup, raw smoky energy, studio quality.' },
  { id: 'acid-jazz', label: '🪩 Acid Jazz', cat: 'jazz', prompt: 'Acid jazz cover, groovy clavinet riffs, Hammond organ, deep funky bassline, packed brass stabs, lounge-dance fusion energy, studio quality.' },
  { id: 'free-jazz', label: '🕊️ Free Jazz / Avant-Garde', cat: 'jazz', prompt: 'Free jazz cover, unbound collective improvisation, cries of saxophones, restless drums, dissonant piano clusters, boundary-pushing avant-garde spirit, studio quality.' },
  { id: 'jazz-fusion', label: '🎛️ Jazz Fusion / Jazz-Rock', cat: 'jazz', prompt: 'Jazz fusion cover, complex harmonies over rock groove, electric piano, slap bass, fiery soloing guitars/sax, virtuosic syncopated drums, studio quality.' },
  { id: 'gypsy-jazz', label: '🎻 Gypsy Jazz / Jazz Manouche', cat: 'jazz', prompt: 'Gypsy jazz cover, propulsive acoustic guitar la pompe rhythm, virtuosic violin and Django-style lead guitar, upright bass, Parisian 1930s swing, studio quality.' },
  { id: 'blues', label: '🎺 Blues', cat: 'jazz', prompt: 'Blues cover, gritty electric guitar, shuffle groove, walking bass, harmonica, soulful and raw, studio quality.' },

  // ── Indonesia & Asia ──────────────────────────────────────────
  { id: 'kpop', label: '🇰🇷 K-Pop', cat: 'asia', prompt: 'K-pop cover, catchy hooks, bright synths, punchy drums, tight harmonies, glossy modern production, studio quality.' },
  { id: 'city-pop', label: '🌆 City Pop', cat: 'asia', prompt: 'Japanese city pop cover, sunny electric piano, funky muted guitar licks, groovy bassline, polished 80s synth strings, yuppy Tokyo coastal vibe, studio quality.' },
  { id: 'j-pop', label: '🌸 J-Pop', cat: 'asia', prompt: 'J-pop cover, bright vibrant arranging piano/band backing, uplifting anime-esque melody, airy youthful vocal, sparkling Japanese pop energy, studio quality.' },
  { id: 'j-rock', label: '⛩️ J-Rock', cat: 'asia', prompt: 'J-rock cover, punchy distorted guitars with fast syncopated bass, magical energetic drumming, emotive young vocal, anime opening vibe, studio quality.' },
  { id: 'keroncong', label: '🪘 Keroncong', cat: 'asia', prompt: 'Keroncong cover, ukulele, cak and cuk, cello, flute, violin, nostalgic Indonesian classic arrangement, sing in Indonesian, studio quality.' },
  { id: 'campursari', label: '🌾 Campursari', cat: 'asia', prompt: 'Campursari cover, modern keyboard blended with gamelan gending, gentle kendang groove, Javanese ornamentation, warm cultural nostalgic charm, sing in Javanese, studio quality.' },
  { id: 'dangdut', label: '🥁 Dangdut Koplo', cat: 'asia', prompt: 'Dangdut koplo cover, kendang, suling, bass dangdut, organ tunggal, energetic groove, catchy and danceable, sing in Indonesian, studio quality.' },
  { id: 'gamelan', label: '🏮 Gamelan Jawa / Bali', cat: 'asia', prompt: 'Gamelan cover, interlocking bronze gongs and metallophones kebyar, soft bebonangan shimmer, ancient meditative ceremony energy, sing with Javanese tone, studio quality.' },

  // ── Dunia & Tradisional ───────────────────────────────────────
  { id: 'reggae', label: '🎸 Roots Reggae', cat: 'dunia', prompt: 'Full song cover, warm groovy arrangement, 84 BPM roots reggae, one drop drums, deep warm bassline, clean off-beat guitar skank, Hammond organ bubble, melodica lead, soft percussion shaker, relaxed and laid back behind the beat, studio quality.' },
  { id: 'ska', label: '🎺 Ska', cat: 'dunia', prompt: 'Traditional ska cover, skanking offbeat guitar, walking bassline, punchy horn stabs, bright Rudy-era Jamaican bounce, sunny feel-good energy, studio quality.' },
  { id: 'folk', label: '🪕 Folk', cat: 'dunia', prompt: 'Warm folk cover, acoustic guitar, banjo, light percussion, intimate storytelling vibe, organic and cozy, studio quality.' },
  { id: 'country', label: '🤠 Country', cat: 'dunia', prompt: 'Country cover, twangy acoustic guitar, pedal steel, warm bass, steady drums, heartfelt storytelling, studio quality.' },
  { id: 'math-folk', label: '🪶 Math Folk / Contemporary Folk', cat: 'dunia', prompt: 'Math folk cover, intricate percussive fingerstyle guitar, odd-meter strumming, intimate close-mic vocal, poetic organic texture, studio quality.' },
  { id: 'flamenco', label: '💃 Flamenco', cat: 'dunia', prompt: 'Flamenco cover, fiery rasgueado nylon-string guitar, palmas claps, cajon groove, passionate cante jondo vocal, dramatic Andalusian duende, studio quality.' },
  { id: 'tango', label: '🎭 Tango', cat: 'dunia', prompt: 'Tango cover, dramatic bandoneón lines, staccato piano and bass accents, sultry violin, brooding Buenos Aires dance-hall tension, studio quality.' },
  { id: 'fado', label: '🕯️ Fado', cat: 'dunia', prompt: 'Fado cover, Portuguese twelve-string saudade guitar, plaintive expressive vocal, mournful melancholic longing, intimate Lisbon nighttime atmosphere, studio quality.' },
  { id: 'bossanova', label: '🌊 Bossa Nova', cat: 'dunia', prompt: 'Bossa nova cover, gentle nylon-string guitar, soft brushed drums, mellow bass, breezy relaxed groove, intimate, studio quality.' },
  { id: 'tropical', label: '🌴 Tropical', cat: 'dunia', prompt: 'Tropical house cover, marimba plucks, soft four-on-the-floor, warm bass, breezy summer vibe, studio quality.' },

  // ── Klasik & Sinematik ────────────────────────────────────────
  { id: 'baroque', label: '🕯️ Baroque', cat: 'klasik', prompt: 'Baroque cover, harpsichord continuo, ornamental violin counterpoint, cello line, contrapuntal elegance, candlelit 18th century salon, studio quality.' },
  { id: 'orchestral', label: '🎻 Symphonic / Orchestral', cat: 'klasik', prompt: 'Full symphonic orchestral cover, lush strings, soaring French horns, timpani and harp, grand sweeping concert-hall arrangements, studio quality.' },
  { id: 'chamber', label: '🏛️ Chamber Music', cat: 'klasik', prompt: 'Chamber music cover, intimate string quartet textures, delicate interwoven classical phrasing, refined salon intimacy, studio quality.' },
  { id: 'ambient', label: '🌫️ Ambient', cat: 'klasik', prompt: 'Ambient cover, slowly evolving pads and drones, sparse delicate textures, infinite spacious reverb, contemplative drifting stillness, studio quality.' },
  { id: 'neoclassical', label: '🎹 Neoclassical', cat: 'klasik', prompt: 'Neoclassical cover, delicate felt piano melodies, subtle strings swell, minimalist modern classical phrasing, tender introspective mood, studio quality.' },
  { id: 'new-age', label: '🌠 New Age', cat: 'klasik', prompt: 'New age cover, serene synth pads, soft ethereal flutes, gentle chimes, meditative healing atmosphere, weightless tranquility, studio quality.' },
  { id: 'cinematic', label: '🎬 Cinematic', cat: 'klasik', prompt: 'Cinematic orchestral cover, sweeping strings, epic horns, powerful percussion, dramatic build, epic film-score production, studio quality.' },
  { id: 'lofi', label: '🌙 Lo-Fi', cat: 'klasik', prompt: 'Lo-fi chill cover, dusty warm vinyl texture, mellow keys, soft boom-bap drums, relaxed nostalgic vibe, studio quality.' },

  // ── Lebih Populer (existing) ──────────────────────────────────
  { id: 'acoustic', label: '🎻 Acoustic', cat: 'klasik', prompt: 'Intimate acoustic cover, fingerstyle guitar, soft piano, gentle strings, natural room reverb, emotional and relaxed, studio quality.' },
  { id: 'pop', label: '🎤 Pop', cat: 'pop-edm', prompt: 'Modern pop cover, punchy drums, bright synths, layered backing vocals, polished radio-ready production, energetic and uplifting, studio quality.' },
  { id: 'ballad', label: '💧 Ballad', cat: 'klasik', prompt: 'Emotional piano ballad cover, grand piano, cinematic strings, building dynamics, heartfelt and dramatic, studio quality.' },
]

export const GENRE_BY_CATEGORY = (cat: string) => STYLE_PRESETS.filter((p) => cat === 'all' || p.cat === cat)
