import { LocalizedError, message, type Message } from '../i18n'
import { loadPolicy } from '../core/load-policy'

/** 本次加载的可见性/离页/截止时间策略；不恢复、不重试，也不改变共享请求预算。 */
export function loadLifecycle(parent: AbortSignal, continueInBackground: boolean, doc: Document = document, win: Window = window) {
  const controller = new AbortController()
  let reason = message('error.cancelled')
  const stop = (notice: Message) => { if (!controller.signal.aborted) { reason = notice; controller.abort() } }
  const cancel = () => stop(message('error.cancelled'))
  const visibility = () => { if (doc.hidden && !continueInBackground) stop(message('error.hidden')) }
  const leave = () => stop(message('error.pageLeft'))
  const timer = win.setTimeout(() => stop(message('error.deadline')), loadPolicy.actionTimeoutMs)
  parent.addEventListener('abort', cancel, { once: true })
  doc.addEventListener('visibilitychange', visibility)
  win.addEventListener('pagehide', leave)
  if (parent.aborted) cancel()
  visibility()
  return {
    signal: controller.signal,
    error(error: unknown) {
      if (!controller.signal.aborted || (error as Error)?.name !== 'AbortError') return error
      const stopped = new LocalizedError(reason); stopped.name = 'AbortError'; return stopped
    },
    dispose() {
      win.clearTimeout(timer)
      parent.removeEventListener('abort', cancel)
      doc.removeEventListener('visibilitychange', visibility)
      win.removeEventListener('pagehide', leave)
    },
  }
}
