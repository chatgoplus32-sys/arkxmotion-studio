import { Router, Request, Response } from 'express'
import { spawn } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, statSync } from 'fs'

const router = Router()

// ── Konfigurasi ──────────────────────────────────────────────────────
const PYTHON_SCRIPT = join(process.cwd(), 'python', 'watermark_cleaner', 'cli.py')
const WATERMARK_OUTPUT_DIR = join(process.cwd(), 'data', 'watermark_cleaned')

if (!existsSync(WATERMARK_OUTPUT_DIR)) {
  mkdirSync(WATERMARK_OUTPUT_DIR, { recursive: true })
}

function log(msg: string) {
  console.log(`[watermark-clean] ${msg}`)
}

/**
 * POST /api/public/runninghub/watermark-clean
 * Body: { taskId, videoUrl }
 */
router.post('/clean', async (req: Request, res: Response) => {
  try {
    const { taskId, videoUrl } = req.body

    if (!videoUrl) {
      return res.status(400).json({ ok: false, error: 'Missing videoUrl' })
    }

    const task_id = taskId || `clean_${Date.now()}`

    log(`Memulai pembersihan: taskId=${task_id}, url=${videoUrl}`)

    // Jalankan pipeline Python
    const python = process.env.PYTHON_EXECUTABLE || 'python3'
    const child = spawn(python, [
      PYTHON_SCRIPT,
      '--url', videoUrl,
      '--id', task_id,
      '--output', WATERMARK_OUTPUT_DIR,
      '--crf', '18'
    ], {
      cwd: join(process.cwd(), 'python', 'watermark_cleaner'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => { stdout += data.toString() })
    child.stderr.on('data', (data) => { stderr += data.toString() })

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Python pipeline exit code ${code}: ${stderr.slice(-500)}`))
      })
      child.on('error', (err) => reject(err))
    })

    log(`Python stdout: ${stdout.slice(0, 300)}`)

    const cleanPath = join(WATERMARK_OUTPUT_DIR, `clean_${task_id}.mp4`)

    if (!existsSync(cleanPath)) {
      console.error(`[watermark-clean] File tidak ditemukan: ${cleanPath}`)
      console.error(`[watermark-clean] stdout: ${stdout}`)
      console.error(`[watermark-clean] stderr: ${stderr.slice(-500)}`)
      return res.status(500).json({ ok: false, error: 'Cleaned video not found' })
    }

    const stat = statSync(cleanPath)
    const fileSize = (stat.size / (1024 * 1024)).toFixed(2)

    log(`Selesai: ${cleanPath} (${fileSize} MB)`)

    return res.json({
      ok: true,
      taskId: task_id,
      cleanVideoUrl: `/api/public/runninghub/watermark-clean/download/${task_id}`,
      fileSizeMb: Number(fileSize),
      message: 'Watermark RunningHub berhasil dibersihkan',
    })
  } catch (err: any) {
    console.error('[watermark-clean] error:', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

/**
 * GET /api/public/runninghub/watermark-clean/download/:taskId
 */
router.get('/download/:taskId', (req: Request, res: Response) => {
  const { taskId } = req.params
  const cleanPath = join(WATERMARK_OUTPUT_DIR, `clean_${taskId}.mp4`)

  if (!existsSync(cleanPath)) {
    return res.status(404).json({ ok: false, error: 'Cleaned video not found' })
  }

  res.setHeader('Content-Type', 'video/mp4')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.download(cleanPath, `clean_${taskId}.mp4`)
})

export default router
