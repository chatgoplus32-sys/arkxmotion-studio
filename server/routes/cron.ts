import { Router, Request, Response, NextFunction } from 'express'
import db from '../db.js'
import { backupOnStartup } from '../backup.js'

const router = Router()

function requireCronSecret(req: Request, res: Response, next: NextFunction) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET belum dikonfigurasi' })
  }
  const header = req.headers['x-cron-secret']
  const query = req.query.secret
  const auth = req.headers.authorization
  if (header === cronSecret || query === cronSecret || auth === `Bearer ${cronSecret}`) {
    return next()
  }
  return res.status(401).json({ error: 'Unauthorized cron' })
}

router.get('/daily-stats', requireCronSecret, (req, res: Response) => {
  try {
    const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c
    const pendingUsers = (db.prepare("SELECT COUNT(*) as c FROM users WHERE approved=0 AND role!='admin'").get() as any).c
    const totalLogs = (db.prepare('SELECT COUNT(*) as c FROM generation_logs').get() as any).c
    const todayLogs = (db.prepare("SELECT COUNT(*) as c FROM generation_logs WHERE DATE(created_at)=DATE('now')").get() as any).c
    const totalCredits = (db.prepare("SELECT COALESCE(SUM(credits),0) as c FROM generation_logs WHERE status='completed'").get() as any).c
    const byProvider = db.prepare('SELECT provider, COUNT(*) as count FROM generation_logs GROUP BY provider ORDER BY count DESC LIMIT 5').all()

    const payload = { date: new Date().toISOString().slice(0,10), totalUsers, pendingUsers, totalLogs, todayLogs, totalCredits, byProvider }
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('cron_last_daily_stats', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP").run(JSON.stringify(payload))
    db.prepare("INSERT INTO notifications (title, message, type, target) VALUES (?, ?, 'info', 'admins')").run('Daily Stats', `Users: ${totalUsers} (pending ${pendingUsers}) • Logs: ${totalLogs} (today ${todayLogs}) • Credits: ${totalCredits}`)

    res.json({ ok: true, ...payload })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.post('/daily-stats', requireCronSecret, (req, res: Response) => {
  return (router as any).handle({ ...req, method: 'GET', url: '/daily-stats' }, res, () => {})
})

router.get('/backup', requireCronSecret, async (_req, res: Response) => {
  try {
    const file = await backupOnStartup()
    res.json({ ok: true, file: file || null, message: file ? 'Backup created' : 'No data to backup' })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/backup', requireCronSecret, async (req, res: Response) => {
  return (router as any).handle({ ...req, method: 'GET', url: '/backup' }, res, () => {})
})

export default router
