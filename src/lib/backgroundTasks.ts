import { pollMotionControl } from '@/lib/roboneo'

const ACTIVE_KEY = 'arkxmotion_active_tasks'
const RESULTS_KEY = 'arkxmotion_results'
const LOGS_KEY = 'arkxmotion_bg_logs'

export interface ActiveTask {
  id: string
  taskId: string
  roomId: string
  token: string
  model: string
  prompt: string
  startedAt: number
  page: 'motion' | 'image-to-video'
}

export interface CompletedResult {
  id: string
  url: string
  prompt: string
  date: string
  page: 'motion' | 'image-to-video'
}

export interface LogEntry {
  time: string
  msg: string
  level: string
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

export function getLogs(): LogEntry[] { return readJson(LOGS_KEY, []) }

export function addBgLog(msg: string, level = 'info') {
  const logs = getLogs()
  logs.push({ time: new Date().toLocaleTimeString(), msg, level })
  writeJson(LOGS_KEY, logs.slice(-200))
}

export function clearLogs() { localStorage.removeItem(LOGS_KEY) }

export function clearAllTasks() {
  localStorage.removeItem(ACTIVE_KEY)
  localStorage.removeItem(RESULTS_KEY)
  localStorage.removeItem(LOGS_KEY)
}

const _controllers = new Map<string, AbortController>()
const _active = new Set<string>()

export function forceStopTask(taskId: string): boolean {
  const ctrl = _controllers.get(taskId)
  if (ctrl) {
    ctrl.abort()
    _controllers.delete(taskId)
    _active.delete(taskId)
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
  for (const [id, ctrl] of _controllers) {
    ctrl.abort()
    count++
  }
  _controllers.clear()
  _active.clear()
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

    addBgLog(`Resuming background poll: ${task.model} (${task.taskId.slice(0, 20)}...)`)

    pollMotionControl(
      task.token, task.taskId, task.roomId,
      (status, pct) => {
        if (!ctrl.signal.aborted) {
          addBgLog(`[bg] ${task.model}: ${status} — ${pct}%`)
        }
      },
      1800000,
    )
      .then((url) => {
        if (ctrl.signal.aborted) return
        addResult({ id: task.taskId, url, prompt: task.prompt, date: new Date().toISOString(), page: task.page })
        removeActiveTask(task.taskId)
        _active.delete(task.taskId)
        _controllers.delete(task.taskId)
        addBgLog(`✅ Background task done ✓ ${url.slice(0, 60)}...`, 'success')
        window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return
        addBgLog(`❌ Background task error: ${err.message}`, 'error')
        removeActiveTask(task.taskId)
        _active.delete(task.taskId)
        _controllers.delete(task.taskId)
        window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
      })
  }
}
