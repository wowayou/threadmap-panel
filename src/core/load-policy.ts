/** 本地自保预算，不是站点公布的配额，也不保证账号不会被限制。没有自动续跑。 */
export const loadPolicy = {
  batchSize: 20,
  maxRequests: 5, // 包含主题 JSON；不按未知的服务器首批帖子数承诺楼层总数
  minIntervalMs: 5_000,
  maxIntervalMs: 60_000,
  defaultPosts: 20,
  maxPosts: 100,
  actionTimeoutMs: 5 * 60_000,
  requestTimeoutMs: 20_000,
  windowMs: 60 * 60_000,
  maxWindowRequests: 60,
  actionCooldownMs: 60_000,
  errorCooldownMs: 10 * 60_000,
  blockedCooldownMs: 30 * 60_000,
  /** 单个响应按实际读取字节限制（不只信 Content-Length）；20 楼满额正文也在此内。 */
  maxResponseBytes: 16 * 1024 * 1024,
} as const

export interface LoadSelection {
  maxPosts: number
  delayMs: number
  /** 每次加载单独确认，不保存成无限后台任务的许可。 */
  continueInBackground: boolean
}
export interface LoadMeter { added: number; requests: number; target: number }
export interface LoadSummary extends LoadMeter { reason: 'complete' | 'target' | 'budget' }

/** 这些失败要求用户重新核对权限/站点防护，不因换模式自动恢复请求许可。 */
export function isProtectionFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const failure = error as { status?: number; challenge?: boolean }
  return failure.challenge === true || failure.status === 401 || failure.status === 403 || failure.status === 429
}
