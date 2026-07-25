import { pollMotionControl } from '@/lib/roboneo'

const STORAGE_KEY = 'arkxmotion_active_tasks'
const RESULTS_KEY = 'arkxmotion_results'

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

export function getActiveTasks(): ActiveTask[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function saveActiveTasks(tasks: ActiveTask[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
}

export function addActiveTask(task: ActiveTask) {
  const tasks = getActiveTasks()
  tasks.push(task)
  saveActiveTasks(tasks)
}

export function removeActiveTask(taskId: string) {
  const tasks = getActiveTasks().filter((t) => t.taskId !== taskId)
  saveActiveTasks(tasks)
}

export function getResults(): CompletedResult[] {
  try {
    return JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]')
  } catch {
    return []
  }
}

export function saveResults(results: CompletedResult[]) {
  localStorage.setItem(RESULTS_KEY, JSON.stringify(results.slice(0, 50)))
}

export function addResult(result: CompletedResult) {
  const results = getResults()
  results.unshift(result)
  saveResults(results)
}

export function clearResults() {
  localStorage.removeItem(RESULTS_KEY)
}

let _pollingActive = new Set<string>()

export function startBackgroundPolling(
  onResult: (task: ActiveTask, url: string) => void,
  onLog: (task: ActiveTask, msg: string) => void,
  onDone: () => void,
) {
  const tasks = getActiveTasks()

  if (tasks.length === 0) {
    onDone()
    return
  }

  for (const task of tasks) {
    if (_pollingActive.has(task.taskId)) continue
    _pollingActive.add(task.taskId)

    onLog(task, `Resuming background poll for task ${task.taskId.slice(0, 20)}...`)

    pollMotionControl(
      task.token,
      task.taskId,
      task.roomId,
      (status, pct) => onLog(task, `[bg] ${task.model}: ${status} — ${pct}%`),
      1800000,
    )
      .then((url) => {
        onResult(task, url)
        removeActiveTask(task.taskId)
        _pollingActive.delete(task.taskId)
        onLog(task, `Background task completed ✓ ${url.slice(0, 60)}...`)
        if (getActiveTasks().length === 0) onDone()
      })
      .catch((err) => {
        onLog(task, `Background task error: ${err.message}`)
        removeActiveTask(task.taskId)
        _pollingActive.delete(task.taskId)
        if (getActiveTasks().length === 0) onDone()
      })
  }
}
