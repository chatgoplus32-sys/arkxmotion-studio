// ─── Folder sementara tes: dibuat tercatat, dihapus otomatis ─────────────────
// Empat file tes membuat folder mkdtemp (gate3-, prodenv-, startup-, retention-)
// tanpa pernah menghapusnya: tmpdir di mesin ini menampung 238 folder basi per
// 15 Nov 2026. Helper ini menutupnya dua lapis:
//
//   1. saat muat — bersihkan folder basi prefix yang dikenal; berkas berumur
//      > 1 jam dianggap sisa run sebelumnya, milik run lain yang masih hidup
//      tidak pernah disentuh;
//   2. saat selesai — test.after(bersihkanFolderTes) menghapus folder yang
//      dibuat run ini, walau tesnya gagal atau di-kill di tengah jalan.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Prefix folder sementara yang dibuat file tes di proyek ini. */
const PREFIX_DIKENAL = [
  'gate3-',
  'prodenv-',
  'startup-empty-',
  'startup-created-',
  'startup-file-',
  'retention-',
]

const UMUR_BASI_MS = 60 * 60 * 1000 // 1 jam

function bersihkanFolderBasi() {
  let nama: string[]
  try {
    nama = fs.readdirSync(os.tmpdir())
  } catch {
    return // tmpdir tidak terbaca — bukan tugas tes ini
  }
  const batas = Date.now() - UMUR_BASI_MS
  for (const n of nama) {
    if (!PREFIX_DIKENAL.some((p) => n.startsWith(p))) continue
    try {
      const p = path.join(os.tmpdir(), n)
      if (fs.statSync(p).mtimeMs > batas) continue // masih ditulis run lain
      fs.rmSync(p, { recursive: true, force: true })
    } catch {
      /* terkunci atau sudah hilang — abaikan */
    }
  }
}
bersihkanFolderBasi()

const folderSementara = new Set<string>()

/** Folder sementara ber-prefix `prefix`, tercatat untuk dihapus saat tes selesai. */
export function tmpTes(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  folderSementara.add(dir)
  return dir
}

/**
 * Hapus semua folder tercatat. Dipanggil lewat test.after; kegagalan menghapus
 * satu folder tidak boleh menggagalkan tes yang lain.
 */
export function bersihkanFolderTes(): void {
  for (const dir of folderSementara) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* terkunci — biarkan, dibersihkan run berikutnya */
    }
  }
  folderSementara.clear()
}
