// ─── Menemukan bash untuk menjalankan skrip gerbang ─────────────────────────
// Gerbang produksi (check-boot-backup.sh, check-prod-env.sh) adalah skrip bash,
// jadi tesnya harus benar-benar men-spawn bash. Linux dan CI selalu punya bash
// di PATH, tapi Windows tidak: di sana Git Bash terpasang di lokasi sendiri
// yang tidak ikut PATH. Tanpa pencarian ini, spawn('bash') gagal ENOENT dan
// belasan tes gerbang gagal bukan karena logikanya salah, tapi karena
// lingkungan — kegagalan semacam itu justru menutupi regresi yang nyata.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** Apakah `cmd --version` bisa dijalankan (bash ada dan berfungsi). */
function bisa(cmd: string): boolean {
  try {
    return spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

/** Berkas kandidat Git for Windows di luar PATH. */
function kandidatWindows(): string[] {
  const dari = (v: string | undefined) => (v ? [path.join(v, 'Git', 'bin', 'bash.exe')] : [])
  return [
    ...dari(process.env.ProgramFiles),
    ...dari(process.env['ProgramFiles(x86)']),
    ...dari(process.env.LOCALAPPDATA),
    ...dari(process.env.USERPROFILE),
  ]
}

/**
 * Jalur bash yang bisa dipakai, atau null kalau mesin ini tidak punya bash
 * sama sekali. PATH dulu (Linux/CI/Windows yang sudah menambahkan Git ke
 * PATH), baru lokasi standar Git for Windows.
 */
function cariBash(): string | null {
  if (bisa('bash')) return 'bash'
  for (const k of kandidatWindows()) {
    if (fs.existsSync(k) && bisa(k)) return k
  }
  return null
}

const jalur = cariBash()

/** Jalur bash untuk spawn, atau 'bash' sebagai cadangan yang akan gagal jelas. */
export const BASH = jalur ?? 'bash'

/**
 * Nilai opsi `skip` node:test: false kalau bash tersedia, atau pesan alasannya.
 * Tes gerbang memakai ini supaya di mesin tanpa bash mereka tercatat SKIP —
 * bukan FAIL — sehingga kegagalan lingkungan tidak lagi menutupi 700+ tes
 * yang benar-benar berjalan.
 */
export const SKIP_TANPA_BASH: string | false = jalur
  ? false
  : 'bash tidak tersedia di mesin ini (butuh Git Bash di Windows; jalur tidak ditemukan)'
