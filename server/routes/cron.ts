import { Router, Response } from 'express'
import db from '../db.js'

const router = Router()

router.get('/daily-stats', (req, res: Response) => {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret && req.query.secret !== cronSecret) {
    const auth = req.headers.authorization
    if (auth !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized cron' })
  }
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

router.post('/daily-stats', (req, res: Response) => {
  return (router as any).handle({ ...req, method: 'GET', url: '/daily-stats' }, res, () => {})
})

export default router
