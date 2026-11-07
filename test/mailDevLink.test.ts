// ─── Test gerbang link dev (reset/verifikasi) ───────────────────────────
// Link reset/verifikasi hanya boleh ikut respons API di lingkungan lokal.
// Kalau gerbang ini jebol, siapa pun yang menebak email terdaftar bisa
// meminta link reset saat SMTP gagal — cukup untuk mengambil alih akun.

import test from 'node:test'
import assert from 'node:assert/strict'

import { allowDevMailLink } from '../server/mailer.js'

const KEYS = ['MAIL_DEV_LINK', 'NODE_ENV', 'APP_URL'] as const

function withEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>, fn: () => void) {
  const saved: Record<string, string | undefined> = {}
  for (const key of KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    fn()
  } finally {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

test('produksi (APP_URL domain publik) tidak membocorkan link dev', () => {
  withEnv({ APP_URL: 'https://arkxmotion-studio.win' }, () => {
    assert.equal(allowDevMailLink(), false)
  })
})

test('domain publik tetap aman walau NODE_ENV tidak diset', () => {
  withEnv({ APP_URL: 'https://example.com', NODE_ENV: undefined }, () => {
    assert.equal(allowDevMailLink(), false)
  })
})

test('localhost mengizinkan link dev untuk pengujian lokal', () => {
  withEnv({ APP_URL: 'http://localhost:5173', NODE_ENV: undefined }, () => {
    assert.equal(allowDevMailLink(), true)
  })
})

test('NODE_ENV=production mematikan link dev walau APP_URL localhost', () => {
  withEnv({ APP_URL: 'http://localhost:5173', NODE_ENV: 'production' }, () => {
    assert.equal(allowDevMailLink(), false)
  })
})

test('MAIL_DEV_LINK=1 / 0 menimpa keputusan otomatis', () => {
  withEnv({ APP_URL: 'https://arkxmotion-studio.win', MAIL_DEV_LINK: '1' }, () => {
    assert.equal(allowDevMailLink(), true)
  })
  withEnv({ APP_URL: 'http://localhost:5173', MAIL_DEV_LINK: '0' }, () => {
    assert.equal(allowDevMailLink(), false)
  })
})
