import { pollMotionControl } from '@/lib/roboneo'

const ACTIVE_KEY = 'arkxmotion_active_tasks'
const RESULTS_KEY = 'arkxmotion_results'
const LOGS_KEY = 'arkxmotion_bg_logs'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success'

export interface ActiveTask {
  id: string
  taskId: string
  roomId: string
  nodeId?: string
  token: string
  model: string
  prompt: string
  startedAt: number
  page: 'motion' | 'image-to-video' | 'upscaler'
}

export interface CompletedResult {
  id: string
  url: string
  prompt: string
  date: string
  page: 'motion' | 'image-to-video' | 'upscaler'
}

export interface LogEntry {
  time: string
  msg: string
  level: LogLevel
  provider?: string
  step?: string
}

function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback }
  catch { return fallback }
}

function writeJson(key: string, value: any) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function getActiveTasks(): ActiveTask[] { return readJson(ACTIVE_KEY, []) }
function saveActiveTasks(t: ActiveTask[]) { writeJson(ACTIVE_KEY, t) }

export function addActiveTask(task: ActiveTask) {
  const t = getActiveTasks(); t.push(task); saveActiveTasks(t)
}

export function removeActiveTask(taskId: string) {
  saveActiveTasks(getActiveTasks().filter((t) => t.taskId !== taskId))
}

export function getResults(): CompletedResult[] { return readJson(RESULTS_KEY, []) }
function saveResults(r: CompletedResult[]) { writeJson(RESULTS_KEY, r.slice(0, 50)) }

export function addResult(result: CompletedResult) {
  const r = getResults(); r.unshift(result); saveResults(r)
}

export function clearResults() { localStorage.removeItem(RESULTS_KEY) }

export function removeResult(id: string) {
  const results = getResults().filter(r => r.id !== id)
  saveResults(results)
}

export function getLogs(): LogEntry[] { return readJson(LOGS_KEY, []) }

export function addBgLog(msg: string, level: LogLevel = 'info', provider?: string, step?: string) {
  const logs = getLogs()
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  logs.push({ time, msg, level, provider, step })
  writeJson(LOGS_KEY, logs.slice(-300))
}

export function clearLogs() { localStorage.removeItem(LOGS_KEY) }

export function clearAllTasks() {
  localStorage.removeItem(ACTIVE_KEY)
  localStorage.removeItem(RESULTS_KEY)
  localStorage.removeItem(LOGS_KEY)
}

const _controllers = new Map<string, AbortController>()
const _active = new Set<string>()
const _pollTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const TASK_TIMEOUT_MS = 3600000

export function forceStopTask(taskId: string): boolean {
  const ctrl = _controllers.get(taskId)
  if (ctrl) {
    ctrl.abort()
    _controllers.delete(taskId)
    _active.delete(taskId)
    const timeout = _pollTimeouts.get(taskId)
    if (timeout) { clearTimeout(timeout); _pollTimeouts.delete(taskId) }
    removeActiveTask(taskId)
    addBgLog(`⛔ Force stopped task: ${taskId.slice(0, 20)}...`, 'error')
    window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
    return true
  }
  removeActiveTask(taskId)
  window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
  return false
}

export function forceStopAllTasks(): number {
  let count = 0
  for (const [, ctrl] of _controllers) {
    ctrl.abort()
    count++
  }
  _controllers.clear()
  _active.clear()
  for (const [, timeout] of _pollTimeouts) { clearTimeout(timeout) }
  _pollTimeouts.clear()
  const tasks = getActiveTasks()
  for (const t of tasks) {
    addBgLog(`⛔ Force stopped task: ${t.model} (${t.taskId.slice(0, 20)}...)`, 'error')
  }
  localStorage.removeItem(ACTIVE_KEY)
  addBgLog(`⛔ All tasks force stopped (${count} active)`, 'error')
  window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
  return count
}

export function getActiveControllerCount(): number {
  return _controllers.size
}

export function startBackgroundPolling() {
  const tasks = getActiveTasks()
  if (tasks.length === 0) return

  for (const task of tasks) {
    if (_active.has(task.taskId)) continue
    _active.add(task.taskId)

    const ctrl = new AbortController()
    _controllers.set(task.taskId, ctrl)

    addBgLog(`🔄 Resuming background poll: ${task.model} (${task.taskId.slice(0, 20)}...)`, 'info')

    const elapsed = Date.now() - task.startedAt
    if (elapsed > TASK_TIMEOUT_MS) {
      addBgLog(`⏰ Task timeout exceeded (${Math.floor(elapsed / 60000)}m). Stopping.`, 'error')
      removeActiveTask(task.taskId)
      _active.delete(task.taskId)
      _controllers.delete(task.taskId)
      window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
      continue
    }

    const timeout = setTimeout(() => {
      if (_active.has(task.taskId)) {
        addBgLog(`⏰ Task timeout (${TASK_TIMEOUT_MS / 60000}m). Force stopping.`, 'error')
        forceStopTask(task.taskId)
      }
    }, TASK_TIMEOUT_MS - elapsed)
    _pollTimeouts.set(task.taskId, timeout)

    pollWithRetry(task, ctrl, 0)
  }
}

const MAX_BG_RETRIES = 3

function pollWithRetry(task: ActiveTask, ctrl: AbortController, attempt: number) {
  if (ctrl.signal.aborted) return

  pollMotionControl(
    task.token, task.taskId, task.roomId,
    (status, pct) => {
      if (!ctrl.signal.aborted) {
        addBgLog(`⏳ ${task.model}: ${status} — ${pct}%`)
      }
    },
    TASK_TIMEOUT_MS - (Date.now() - task.startedAt),
    ctrl.signal,
    task.nodeId,
  )
    .then((url) => {
      if (ctrl.signal.aborted) return
      const t = _pollTimeouts.get(task.taskId)
      if (t) { clearTimeout(t); _pollTimeouts.delete(task.taskId) }
      addResult({ id: task.taskId, url, prompt: task.prompt, date: new Date().toISOString(), page: task.page })
      removeActiveTask(task.taskId)
      _active.delete(task.taskId)
      _controllers.delete(task.taskId)
      addBgLog(`✅ Background task done ✓ ${url.slice(0, 60)}...`, 'success')
      window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
    })
    .catch((err) => {
      if (ctrl.signal.aborted) return

      const isBusy = /busy|sibuk|try again|later|overload|capacity|queue|结果接口获取失败|error_code.*6/i.test(err.message)
      if (isBusy && attempt < MAX_BG_RETRIES) {
        const waitSec = 10 + attempt * 10
        addBgLog(`⚠️ ${task.model}: server sibuk, retry ${attempt + 1}/${MAX_BG_RETRIES} dalam ${waitSec}s...`, 'warn')
        setTimeout(() => {
          if (!ctrl.signal.aborted) {
            pollWithRetry(task, ctrl, attempt + 1)
          }
        }, waitSec * 1000)
        return
      }

      const t = _pollTimeouts.get(task.taskId)
      if (t) { clearTimeout(t); _pollTimeouts.delete(task.taskId) }
      addBgLog(`❌ Background task error: ${err.message}`, 'error')
      removeActiveTask(task.taskId)
      _active.delete(task.taskId)
      _controllers.delete(task.taskId)
      window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
    })
}
