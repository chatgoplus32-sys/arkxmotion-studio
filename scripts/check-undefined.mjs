#!/usr/bin/env node
/**
 * GERBANG: identifier dipakai tapi tidak terdefinisi.
 *
 * Menutup dua kelas bug yang pernah menimbulkan outage produksi (502 di semua
 * endpoint) dan tidak tertangkap gerbang mana pun yang sudah ada:
 *
 *   1. Identifier tidak terdefinisi (TS2304 / TS2552)
 *      Mis. import yang terhapus tanpa sengaja sehingga server gagal boot:
 *      "ReferenceError: authRoutes is not defined".
 *
 *   2. API Node dipakai di file ESM
 *      package.json proyek ini memakai "type": "module", jadi `require`,
 *      `module.exports`, `__dirname`, dan `__filename` TIDAK ADA saat runtime —
 *      tetapi TypeScript tetap menganggapnya ada karena dideklarasikan oleh
 *      @types/node. Kelas inilah yang membuat unggahan R2 diam-diam tidak
 *      pernah berjalan (selalu jatuh ke local-only tanpa error).
 *
 * Sebagian besar proyek sudah diperiksa `tsc -b`, tapi 40+ file (extensions/,
 * workers/, cloudflare-worker/, skrip di root, public/sw.js, vite.config.ts,
 * vite-plugin-roboneo.ts, shared/) berada di luar semua tsconfig sehingga tidak
 * pernah diperiksa sama sekali. Skrip ini menutup celah itu.
 *
 * Pemakaian:  node scripts/check-undefined.mjs
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP_CONFIG = path.join(ROOT, '.tsconfig.undefined-check.json')

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.freebuff', 'logs',
  'data', 'backup', 'backups', '.vercel', '.next', '.tmp-extensions', '.github',
])
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

/** Global yang memang disediakan runtime lain, bukan oleh JavaScript/Node. */
const ALLOWED_UNDEFINED = new Set([
  'chrome', // API ekstensi browser (manifest v3), tidak disediakan @types/node
])

// ---------------------------------------------------------------------------
// 1. Kumpulkan SEMUA file kode, termasuk yang di luar semua tsconfig
// ---------------------------------------------------------------------------

/** @returns {string[]} path relatif terhadap ROOT, memakai '/' */
function collectFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(abs)
      } else if (CODE_EXT.has(path.extname(entry.name)) && !entry.name.endsWith('.d.ts')) {
        out.push(path.relative(ROOT, abs).split(path.sep).join('/'))
      }
    }
  }
  walk(ROOT)
  return out.sort()
}

// ---------------------------------------------------------------------------
// 2. Pemeriksaan statik: jalankan tsc atas SELURUH file, saring TS2304/TS2552
// ---------------------------------------------------------------------------

function typecheckAll(files) {
  const config = {
    compilerOptions: {
      target: 'es2023',
      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      module: 'esnext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      types: ['node', 'vite/client'],
      allowJs: true,
      checkJs: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      allowSyntheticDefaultImports: true,
      strict: false,
      noUnusedLocals: false,
      noUnusedParameters: false,
      paths: { '@/*': ['./src/*'] },
    },
    files,
  }
  fs.writeFileSync(TMP_CONFIG, JSON.stringify(config, null, 2))

  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js')
  if (!fs.existsSync(tsc)) {
    throw new Error(`TypeScript tidak ditemukan di ${tsc} — jalankan "npm install" dulu.`)
  }

  let output = ''
  try {
    output = execFileSync(process.execPath, [tsc, '-p', TMP_CONFIG], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (err) {
    output = `${err.stdout || ''}${err.stderr || ''}`
  } finally {
    fs.rmSync(TMP_CONFIG, { force: true })
  }

  const findings = []
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/error (TS2304|TS2552): Cannot find name '([^']+)'/)
    if (!m) continue
    const [, code, name] = m
    if (ALLOWED_UNDEFINED.has(name)) continue
    findings.push({ raw: line.trim(), code, name })
  }
  return findings
}

// ---------------------------------------------------------------------------
// 3. Pemeriksaan runtime: API Node di file ESM (proyek ini "type": "module")
// ---------------------------------------------------------------------------

/**
 * Buang komentar, literal string, DAN literal regex, agar kata seperti
 * "require" di dalam dokumentasi, pesan error, atau pola regex tidak dianggap
 * sebagai kode. Panjang baris dipertahankan supaya nomor baris tetap akurat.
 */
function stripCommentsAndStrings(src) {
  let out = ''
  let i = 0
  const n = src.length
  let state = 'code' // code | line | block | sq | dq | tpl | regex | regexClass

  // '/' adalah pembuka regex bila token bermakna sebelumnya bukan sebuah nilai.
  const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '^', '~', '<', '>'])
  const lastSignificant = () => {
    for (let k = out.length - 1; k >= 0; k--) {
      const ch = out[k]
      if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') continue
      return ch
    }
    return ''
  }

  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && d === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (c === '/' && REGEX_PRECEDERS.has(lastSignificant())) { state = 'regex'; out += ' '; i += 1; continue }
      if (c === "'") { state = 'sq'; out += ' '; i += 1; continue }
      if (c === '"') { state = 'dq'; out += ' '; i += 1; continue }
      if (c === '`') { state = 'tpl'; out += ' '; i += 1; continue }
      out += c; i += 1; continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n' } else { out += ' ' }
      i += 1; continue
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? '\n' : ' '
      i += 1; continue
    }
    if (state === 'regex') {
      if (c === '\\') { out += '  '; i += 2; continue }
      if (c === '[') { state = 'regexClass'; out += ' '; i += 1; continue }
      if (c === '/') { state = 'code'; out += ' '; i += 1; continue }
      if (c === '\n') { state = 'code'; out += '\n'; i += 1; continue }
      out += ' '; i += 1; continue
    }
    if (state === 'regexClass') {
      if (c === '\\') { out += '  '; i += 2; continue }
      if (c === ']') { state = 'regex'; out += ' '; i += 1; continue }
      if (c === '\n') { state = 'code'; out += '\n'; i += 1; continue }
      out += ' '; i += 1; continue
    }
    // di dalam string: hormati escape
    if (c === '\\') { out += '  '; i += 2; continue }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
      state = 'code'; out += ' '; i += 1; continue
    }
    out += c === '\n' ? '\n' : ' '
    i += 1
  }
  return out
}

const ESM_PATTERNS = [
  { name: 'require', re: /(^|[^.\w$])require\s*\(/, label: 'require()' },
  { name: 'module.exports', re: /\bmodule\.exports\b/, label: 'module.exports' },
  { name: 'exports', re: /\bexports\.[A-Za-z_$]/, label: 'exports.*' },
  { name: '__dirname', re: /\b__dirname\b/, label: '__dirname' },
  { name: '__filename', re: /\b__filename\b/, label: '__filename' },
]

// Dikecualikan: baris yang memang menyusun jalur dari import.meta.url
const ESM_OK = /\bimport\.meta\.url\b/

function scanEsmGlobals(files) {
  const findings = []
  for (const rel of files) {
    if (rel.endsWith('.cjs')) continue // .cjs memang CommonJS
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    const code = stripCommentsAndStrings(src)
    const lines = code.split(/\r?\n/)
    const rawLines = src.split(/\r?\n/)

    // __dirname/__filename SAH bila file menurunkannya sendiri dari import.meta.url
    // (pola ESM yang benar), jadi tidak boleh dilaporkan sebagai pelanggaran.
    const declares = (name) => new RegExp(`\\b(const|let|var)\\s+${name}\\b`).test(code)
    // require() SAH bila diperoleh lewat createRequire(import.meta.url).
    const usesCreateRequire = /\bcreateRequire\s*\(/.test(code)

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx]
      if (ESM_OK.test(line)) continue
      for (const { name, re, label } of ESM_PATTERNS) {
        if (name === 'require' && usesCreateRequire) continue
        if ((name === '__dirname' || name === '__filename') && declares(name)) continue
        if (re.test(line)) {
          findings.push({ file: rel, line: idx + 1, label, text: (rawLines[idx] || '').trim() })
          break
        }
      }
    }
  }
  return findings
}

// ---------------------------------------------------------------------------
// 4. Laporan
// ---------------------------------------------------------------------------

const files = collectFiles()
console.log(`🔍 Memeriksa ${files.length} file (termasuk yang di luar semua tsconfig)...\n`)

const undefinedFindings = typecheckAll(files)
const esmFindings = scanEsmGlobals(files)

if (undefinedFindings.length === 0 && esmFindings.length === 0) {
  console.log('✅ Bersih — tidak ada identifier tak terdefinisi, tidak ada API Node di file ESM.')
  process.exit(0)
}

if (undefinedFindings.length > 0) {
  console.log(`❌ ${undefinedFindings.length} identifier DIPAKAI TAPI TIDAK TERDEFINISI:`)
  for (const f of undefinedFindings) console.log(`   ${f.raw}`)
  console.log('')
}

if (esmFindings.length > 0) {
  console.log(`❌ ${esmFindings.length} pemakaian API CommonJS di file ESM`)
  console.log('   ("type": "module" => require/module.exports/__dirname TIDAK ADA saat runtime):')
  for (const f of esmFindings) {
    console.log(`   ${f.file}:${f.line}  [${f.label}]`)
    console.log(`      ${f.text.slice(0, 140)}`)
  }
  console.log('')
  console.log('   Perbaikan: pakai `import ... from`, `await import(...)`, dan')
  console.log('   `path.dirname(fileURLToPath(import.meta.url))` sebagai gantinya.')
  console.log('')
}

process.exit(1)
