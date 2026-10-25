import { Router, Request, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'

/**
 * Auto Clipper AI — persistensi proyek (durabel, database existing sqlite).
 *
 * Musim舍得 rendering dilakukan client-side (ffmpeg.wasm) supaya VPS tidak
 * memuat file video ke RAM — server hanya menyimpan STATE: metadata,
 * konfigurasi, transkrip, kandidat klip + skor + alasan, status job, dan
 * hasil URL bila sudah upload ke storage.
 *
 * Table dibuat/termigrasi di sini (pol ALTER-IF seperti db.ts) agar tidak
 * menyentuh db.ts yang dipakai banyak modul lain.
 */

const router = Router()

db.exec(`
  CREATE TABLE IF NOT EXISTS autoclip_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded'
      CHECK(status IN ('uploading','queued','transcribing','analyzing','selecting','editing','rendering','completed','failed','cancelled')),
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    duration REAL NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    thumbnail TEXT,
    settings TEXT,
    transcript TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)
db.exec(`
  CREATE TABLE IF NOT EXISTS autoclip_clips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES autoclip_projects(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    title TEXT,
    hook TEXT,
    reason TEXT,
    score REAL,
    scores TEXT,
    words TEXT,
    screen_focus TEXT,
    subtitle_text TEXT,
    status TEXT NOT NULL DEFAULT 'selected'
      CHECK(status IN ('selected','rendering','completed','failed','cancelled')),
    output_url TEXT,
    render_error TEXT,
    export_enabled INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_autoclip_clips_project ON autoclip_clips(project_id)`)

interface ClipRow {
  id: number
  idx: number
  start_time: number
  end_time: number
  title: string | null
  hook: string | null
  reason: string | null
  score: number | null
  scores: string | null
  words: string | null
  screen_focus: string | null
  status: string
  output_url: string | null
  render_error: string | null
  export_enabled: number
  [k: string]: any
}

function projectPayload(id: number, userId: number) {
  const p = db.prepare('SELECT * FROM autoclip_projects WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!p) return null
  const clips = db.prepare('SELECT * FROM autoclip_clips WHERE project_id = ? ORDER BY idx').all(id) as ClipRow[]
  return { project: p, clips }
}

// GET /api/public/autoclip/projects — daftar proyek milik user
router.get('/projects', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare(
      `SELECT id, status, file_name, file_size, duration, width, height, thumbnail, error, created_at, updated_at
       FROM autoclip_projects WHERE user_id = ? ORDER BY id DESC LIMIT 50`
    ).all(req.user!.id)
    res.json({ ok: true, projects: rows })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// GET /api/public/autoclip/project/:id — detail + klip
router.get('/project/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const data = projectPayload(Number(req.params.id), req.user!.id)
    if (!data) return res.status(404).json({ ok: false, error: 'Proyek tidak ditemukan' })
    res.json({ ok: true, ...data })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// POST /api/public/autoclip/project — buat proyek baru
router.post('/project', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const { fileName, fileSize, duration, width, height, thumbnail, settings } = req.body || {}
    if (!fileName || !duration || !width || !height) {
      return res.status(400).json({ ok: false, error: 'fileName, duration, width, height wajib' })
    }
    const status = 'uploaded'
    const r = db.prepare(
      `INSERT INTO autoclip_projects (user_id, status, file_name, file_size, duration, width, height, thumbnail, settings)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.user!.id,
      status,
      String(fileName).slice(0, 200),
      Number(fileSize) || 0,
      Number(duration) || 0,
      Number(width) || 0,
      Number(height) || 0,
      thumbnail ? String(thumbnail).slice(0, 200000) : null,
      settings ? JSON.stringify(settings) : JSON.stringify({ clipCount: 10, minSeg: 15, maxSeg: 30, targetSeg: 25, aspectMode: '9:16', fps: 30, subtitle: { on: true, font: 'bold', size: 38, color: '#FFFFFF', outline: '#000000', position: 'b', safeZone: 8 } }),
    )
    const data = projectPayload(r.lastInsertRowid as number, req.user!.id)
    res.json({ ok: true, ...data })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// PATCH /api/public/autoclip/project/:id — update status/settings/transcript/error
router.patch('/project/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const p = db.prepare('SELECT id FROM autoclip_projects WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user!.id) as any
    if (!p) return res.status(404).json({ ok: false, error: 'Proyek tidak ditemukan' })
    const sets: string[] = []
    const vals: any[] = []
    if (req.body.status !== undefined) { sets.push('status = ?'); vals.push(String(req.body.status)) }
    if (req.body.settings !== undefined) { sets.push('settings = ?'); vals.push(JSON.stringify(req.body.settings)) }
    if (req.body.transcript !== undefined) { sets.push('transcript = ?'); vals.push(JSON.stringify(req.body.transcript)) }
    if (req.body.thumbnail !== undefined) { sets.push('thumbnail = ?'); vals.push(String(req.body.thumbnail)) }
    if (req.body.error !== undefined) { sets.push('error = ?'); vals.push(String(req.body.error).slice(0, 2000)) }
    if (sets.length === 0) return res.status(400).json({ ok: false, error: 'Tidak ada field untuk diupdate' })
    sets.push('updated_at = CURRENT_TIMESTAMP')
    vals.push(p.id)
    db.prepare(`UPDATE autoclip_projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    const data = projectPayload(p.id, req.user!.id)
    res.json({ ok: true, ...data })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// PUT /api/public/autoclip/project/:id/clips — replace seluruh daftar klip
router.put('/project/:id/clips', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const p = db.prepare('SELECT id FROM autoclip_projects WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user!.id) as any
    if (!p) return res.status(404).json({ ok: false, error: 'Proyek tidak ditemukan' })
    const clips = Array.isArray(req.body.clips) ? req.body.clips : []
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM autoclip_clips WHERE project_id = ?').run(p.id)
      const ins = db.prepare(
        `INSERT INTO autoclip_clips
         (project_id, idx, start_time, end_time, title, hook, reason, score, scores, words, screen_focus, status, export_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      clips.forEach((c: any, i: number) => {
        ins.run(
          p.id,
          i,
          Number(c.startTime) || 0,
          Number(c.endTime) || 0,
          c.title ? String(c.title).slice(0, 300) : null,
          c.hook ? String(c.hook).slice(0, 300) : null,
          c.reason ? String(c.reason).slice(0, 500) : null,
          Number.isFinite(c.score) ? c.score : null,
          c.scores ? JSON.stringify(c.scores) : null,
          Array.isArray(c.words) ? JSON.stringify(c.words) : null,
          c.screenFocus ? JSON.stringify(c.screenFocus) : null,
          c.status ? String(c.status) : 'selected',
          c.exportEnabled === false ? 0 : 1,
        )
      })
    })
    tx()
    const data = projectPayload(p.id, req.user!.id)
    res.json({ ok: true, ...data })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// PATCH /api/public/autoclip/clip/:clipId — edit satu klip
router.patch('/clip/:clipId', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const clip = db.prepare(
      `SELECT c.* FROM autoclip_clips c JOIN autoclip_projects p ON p.id = c.project_id
       WHERE c.id = ? AND p.user_id = ?`
    ).get(Number(req.params.clipId), req.user!.id) as ClipRow | undefined
    if (!clip) return res.status(404).json({ ok: false, error: 'Klip tidak ditemukan' })
    const sets: string[] = []
    const vals: any[] = []
    const b = req.body || {}
    if (b.startTime !== undefined) { sets.push('start_time = ?'); vals.push(Number(b.startTime)) }
    if (b.endTime !== undefined) { sets.push('end_time = ?'); vals.push(Number(b.endTime)) }
    if (b.title !== undefined) { sets.push('title = ?'); vals.push(String(b.title).slice(0, 300)) }
    if (b.hook !== undefined) { sets.push('hook = ?'); vals.push(String(b.hook).slice(0, 300)) }
    if (b.subtitleText !== undefined) { sets.push('subtitle_text = ?'); vals.push(String(b.subtitleText).slice(0, 5000)) }
    if (b.words !== undefined) { sets.push('words = ?'); vals.push(JSON.stringify(b.words)) }
    if (b.screenFocus !== undefined) { sets.push('screen_focus = ?'); vals.push(JSON.stringify(b.screenFocus)) }
    if (b.status !== undefined) { sets.push('status = ?'); vals.push(String(b.status)) }
    if (b.outputUrl !== undefined) { sets.push('output_url = ?'); vals.push(String(b.outputUrl).slice(0, 2000)) }
    if (b.renderError !== undefined) { sets.push('render_error = ?'); vals.push(String(b.renderError).slice(0, 1000)) }
    if (b.exportEnabled !== undefined) { sets.push('export_enabled = ?'); vals.push(b.exportEnabled ? 1 : 0) }
    if (sets.length === 0) return res.status(400).json({ ok: false, error: 'Tidak ada field untuk diupdate' })
    sets.push('updated_at = CURRENT_TIMESTAMP')
    vals.push(clip.id)
    db.prepare(`UPDATE autoclip_clips SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    const data = projectPayload(clip.project_id, req.user!.id)
    res.json({ ok: true, ...data })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// DELETE /api/public/autoclip/project/:id — hapus proyek + klipnya
router.delete('/project/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const r = db.prepare('DELETE FROM autoclip_projects WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user!.id)
    if (r.changes === 0) return res.status(404).json({ ok: false, error: 'Proyek tidak ditemukan' })
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

export default router
