/**
 * SEGEL: kode frontend tidak boleh menampilkan QRIS statis lama atau metode
 * bayar DANA. Semua pembayaran harus lewat QRIS dinamis BasuniPay (nominal
 * unik + verifikasi otomatis).
 *
 * QRIS statis lama (/qris-arkx.jpg, NMID merchant) tidak terikat ke nominal
 * pengajuan tertentu, jadi pembayaran lewat situ TIDAK BISA dicocokkan
 * otomatis — itu sebabnya tidak boleh pernah dirender lagi, di mana pun.
 *
 * Tes ini juga melarang referensi metode bayar DANA (nomor/nama penerima),
 * karena seluruh pembayaran harus lewat QRIS BasuNiPay.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function walkTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walkTs(p))
    else if (/\.(ts|tsx|js|jsx|css|html|md)$/.test(name)) out.push(p)
  }
  return out
}

const SRC_FILES = walkTs(join(ROOT, 'src'))
const rel = (p: string) => relative(ROOT, p).replaceAll('\\', '/')

const FORBIDDEN: Array<[string, string]> = [
  ['qris-arkx', 'aset QRIS statis lama'],
  ['QRIS_IMG', 'konstanta gambar QRIS statis'],
  ['QRIS_MERCHANT', 'nama merchant QRIS statis'],
  ['QRIS_NMID', 'NMID QRIS statis'],
  ['PaymentMethodToggle', 'toggle metode bayar DANA/QRIS statis'],
  ['DANA_NUMBER', 'nomor DANA statis'],
  ['DANA_NAME', 'nama penerima DANA statis'],
  ['082280204445', 'nomor DANA statis (literal)'],
  ['Yusuf Prihandoko', 'nama penerima DANA statis (literal)'],
]

test('tidak ada referensi QRIS statis / metode DANA di src', () => {
  assert.ok(SRC_FILES.length > 50, 'walk src harus menemukan banyak file')
  for (const file of SRC_FILES) {
    const src = readFileSync(file, 'utf8')
    for (const [token, label] of FORBIDDEN) {
      assert.ok(
        !src.includes(token),
        `${rel(file)} masih mengandung ${label} (${token}) — ` +
          'semua pembayaran harus lewat QRIS dinamis BasuNiPay',
      )
    }
  }
})

test('public/qris-arkx.jpg tidak direferensikan kode mana pun', () => {
  // Asetnya boleh saja masih ada di public/, tapi tidak boleh pernah dipakai.
  for (const file of SRC_FILES) {
    const src = readFileSync(file, 'utf8')
    assert.ok(!src.includes('qris-arkx'), `${rel(file)} masih mereferensikan aset QRIS statis`)
  }
})
