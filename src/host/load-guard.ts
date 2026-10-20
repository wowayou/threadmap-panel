import { LocalizedError, message } from '../i18n'
import { isProtectionFailure, loadPolicy } from '../core/load-policy'

/** 只保存请求时间和冷却截止时间，不保存主题、帖子或账号信息。 */
export const LOAD_GUARD_KEY = 'threadmap-load-guard-v1'
const LOCK_NAME = 'threadmap-read-load-v1'

type TrafficState = { requests: number[]; pausedUntil: number }
export interface LoadGuard {
  run<T>(signal: AbortSignal | undefined, work: (beforeRequest: () => Promise<void>) => Promise<T>): Promise<T>
}
export interface GuardEnvironment {
  locks?: Pick<LockManager, 'request'>
  storage: () => Pick<Storage, 'getItem' | 'setItem'>
  now: () => number
}

const stopped = () => { const error = new LocalizedError(message('error.cancelled')); error.name = 'AbortError'; return error }
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) throw stopped() }
const storageError = () => new LocalizedError(message('error.guardStorage'))
const clockError = () => new LocalizedError(message('error.clock'))

function readState(storage: Pick<Storage, 'getItem'>): TrafficState {
  try {
    const raw = storage.getItem(LOAD_GUARD_KEY)
    if (raw === null) return { requests: [], pausedUntil: 0 }
    if (raw.length > 4096) throw storageError()
    const state = JSON.parse(raw)
    if (!state || !Array.isArray(state.requests) || state.requests.length > loadPolicy.maxWindowRequests || !Number.isSafeInteger(state.pausedUntil) || state.pausedUntil < 0 || state.requests.some((n: unknown, i: number) => !Number.isSafeInteger(n) || (n as number) < 0 || (i > 0 && (n as number) < state.requests[i - 1]))) throw storageError()
    return { requests: state.requests, pausedUntil: state.pausedUntil }
  } catch { throw storageError() }
}

function saveState(storage: Pick<Storage, 'getItem' | 'setItem'>, state: TrafficState) {
  try {
    const raw = JSON.stringify(state)
    storage.setItem(LOAD_GUARD_KEY, raw)
    if (storage.getItem(LOAD_GUARD_KEY) !== raw) throw storageError()
  } catch { throw storageError() }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(stopped())
    const finish = () => { signal?.removeEventListener('abort', cancel); resolve() }
    const timer = setTimeout(finish, ms)
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(stopped()) }
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

function cooldown(error: unknown): number {
  if (!error || (error as Error).name === 'AbortError') return loadPolicy.actionCooldownMs
  const failure = error as { status?: number; challenge?: boolean; retryAfter?: number }
  const blocked = isProtectionFailure(error)
  const retry = Number.isSafeInteger(failure.retryAfter) && failure.retryAfter! > 0 && failure.retryAfter! < Number.MAX_SAFE_INTEGER / 1000 ? failure.retryAfter! * 1000 : 0
  return Math.max(blocked ? loadPolicy.blockedCooldownMs : loadPolicy.errorCooldownMs, retry)
}

/**
 * Web Locks 提供同源跨标签页互斥；不排队、不自动恢复。
 * 不支持锁、存储失败或记录异常时宁可禁用主动加载，不退回无保护的请求。
 */
export function createLoadGuard(env: GuardEnvironment = {
  locks: typeof navigator !== 'undefined' ? navigator.locks : undefined,
  storage: () => localStorage,
  now: () => Date.now(),
}): LoadGuard {
  return {
    async run(signal, work) {
      checkAbort(signal)
      if (typeof env.locks?.request !== 'function') throw new LocalizedError(message('error.locks'))
      return env.locks.request(LOCK_NAME, { ifAvailable: true }, async lock => {
        checkAbort(signal)
        if (!lock) throw new LocalizedError(message('error.otherTab'))
        let storage: ReturnType<GuardEnvironment['storage']>
        try { storage = env.storage() } catch { throw storageError() }
        const state = readState(storage), start = env.now()
        if (!Number.isSafeInteger(start) || start < 0 || state.requests.some(time => time > start)) throw clockError()
        if (state.pausedUntil > start) throw new LocalizedError(message('error.cooldown', { seconds: Math.ceil((state.pausedUntil - start) / 1000) }))
        state.requests = state.requests.filter(time => time > start - loadPolicy.windowMs)
        if (state.requests.length >= loadPolicy.maxWindowRequests) throw new LocalizedError(message('error.hourBudget'))
        // 先保守预留一小时：崩溃、关闭页面或最后一次持久化失败，不会立即恢复请求。
        state.pausedUntil = start + loadPolicy.windowMs
        saveState(storage, state)
        let attempts = 0, failure: unknown
        try {
          return await work(async () => {
            checkAbort(signal)
            if (attempts >= loadPolicy.maxRequests) throw new LocalizedError(message('error.actionBudget'))
            const last = state.requests[state.requests.length - 1]
            const delay = last === undefined ? 0 : last + loadPolicy.minIntervalMs - env.now()
            if (delay > 0) await wait(delay, signal)
            checkAbort(signal)
            const now = env.now()
            if (!Number.isSafeInteger(now) || now < start || (last !== undefined && now < last + loadPolicy.minIntervalMs)) throw clockError()
            state.requests = state.requests.filter(time => time > now - loadPolicy.windowMs)
            if (state.requests.length >= loadPolicy.maxWindowRequests) throw new LocalizedError(message('error.hourBudget'))
            state.requests.push(now)
            state.pausedUntil = now + loadPolicy.windowMs
            saveState(storage, state) // 发出请求前计账；失败或取消不退还请求额度
            attempts++
          })
        } catch (error) { failure = error; throw error }
        finally {
          const now = env.now()
          if (Number.isSafeInteger(now) && now >= start) state.pausedUntil = Math.min(Number.MAX_SAFE_INTEGER, now + cooldown(failure))
          saveState(storage, state)
        }
      })
    },
  }
}
