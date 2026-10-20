import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 安全基线（见 docs/security.md）。这些规则保护的是安装脚本的用户：
 * 脚本运行在他们登录后的论坛页面里，任何越界都可能造成损失。
 */

const root = join(__dirname, '..')
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => { const p = join(dir, name); return statSync(p).isDirectory() ? walk(p) : [p] })
const sources = walk(join(root, 'src')).filter(f => /\.(ts|tsx)$/.test(f) && !f.endsWith('readings-data.ts')).map(f => ({ f: f.slice(root.length + 1), code: readFileSync(f, 'utf8') }))
const find = (pattern: RegExp) => sources.flatMap(({ f, code }) => code.split('\n').map((line, i) => ({ f, i: i + 1, line })).filter(({ line }) => pattern.test(line) && !/^\s*(\/\/|\*)/.test(line))).map(({ f, i, line }) => `${f}:${i}: ${line.trim()}`)

describe('安全基线：源码', () => {
  it('不把任何字符串当 HTML 或代码执行', () => {
    expect(find(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write|\beval\s*\(|new Function\s*\(|set(Timeout|Interval)\(\s*['"`]/)).toEqual([])
  })

  it('不发起写操作或第三方请求：网络只经过只读加载器', () => {
    expect(find(/\bfetch\s*\(|XMLHttpRequest\b(?!')|sendBeacon|new WebSocket|new EventSource|import\s*\(/).filter(l => !l.startsWith('src/host/loader.ts'))).toEqual([])
    const loader = readFileSync(join(root, 'src/host/loader.ts'), 'utf8')
    expect(loader.match(/method:\s*'([A-Z]+)'/g)).toEqual(["method: 'GET'"])
    expect(loader).toContain("credentials: 'same-origin'")
    expect(loader).toContain("redirect: 'error'")
    expect(loader).not.toMatch(/https?:\/\//)
  })

  it('不使用油猴特权接口，不读写 cookie', () => {
    expect(find(/\bGM[._]|unsafeWindow|document\.cookie/)).toEqual([])
  })

  it('预览/定位不整页刷新、不调用可能刷新页面的私有路由', () => {
    expect(find(/location\s*(?:\.(?:href|assign|replace|reload))?\s*[=(]|\.routeTo\s*\(/)).toEqual([])
  })

  it('预留阅读API没有接到运行实例或外部传输，不拥有宿主写能力', () => {
    const api = readFileSync(join(root, 'src/core/reader-api.ts'), 'utf8')
    expect(api).not.toMatch(/from ['"].*\/host\//)
    expect(find(/\bfetch\b|\bwindow\b|\bdocument\b|\blocalStorage\b|\bindexedDB\b|addEventListener|setTimeout|setInterval/).filter(line => line.startsWith('src/core/reader-api.ts'))).toEqual([])
    expect(readFileSync(join(root, 'src/userscript.tsx'), 'utf8')).not.toMatch(/createReaderApi|reader-api/)
    expect(readFileSync(join(root, 'src/ui/Widget.tsx'), 'utf8')).not.toMatch(/createReaderApi|reader-api/)
  })

  it('不提交表单、不点击论坛自身的按钮、不改写论坛数据', () => {
    expect(find(/\.submit\(\)|requestSubmit|\.click\(\)|\.ajax\(|\.(save|destroyRecord|deleteRecord|createRecord|updateRecord)\(/)).toEqual([])
  })

  it('设置、纠正、冷却写入受限；正文只能经过独立缓存数据库', () => {
    const keys = sources.flatMap(({ code }) => [...code.matchAll(/'(threadmap-[a-z0-9-]+)'/g)].map(m => m[1]))
    const storedKeys = sources.flatMap(({ code }) => [...code.matchAll(/\b[A-Z_]+_KEY = '([^']+)'/g)].map(m => m[1])).sort()
    expect(storedKeys).toEqual(['threadmap-load-guard-v1', 'threadmap-overrides-v1', 'threadmap-prefs-v2'])
    expect(find(/\.setItem\s*\(/).map(line => line.split(':')[0]).sort()).toEqual(['src/core/storage.ts', 'src/core/storage.ts', 'src/host/load-guard.ts'])
    expect(find(/localStorage\.setItem|sessionStorage/)).toEqual([])
    expect(find(/\bindexedDB\b/).map(line => line.split(':')[0])).toEqual(['src/host/cache-store.ts'])
    expect([...new Set(find(/\.objectStore\s*\(/).map(line => line.split(':')[0]))]).toEqual(['src/host/cache-store.ts'])
    const database = readFileSync(join(root, 'src/host/cache-store.ts'), 'utf8')
    expect(database).toContain("CACHE_DB_NAME = 'threadmap-post-cache-v1'")
    expect(database).toContain('if (!same(c.consent, consent))')
    expect(keys.length).toBeGreaterThan(0)
  })
})

describe('安全基线：构建产物', () => {
  const file = join(root, 'dist/threadmap.user.js')
  const built = existsSync(file) ? readFileSync(file, 'utf8') : ''

  it.skipIf(!built)('元数据：只匹配两个站点的主题页，不申请特权，不引入远程脚本', () => {
    const header = built.slice(0, built.indexOf('// ==/UserScript=='))
    expect([...header.matchAll(/@match\s+(\S+)/g)].map(m => m[1])).toEqual(['https://linux.do/t/*', 'https://meta.discourse.org/t/*'])
    expect(header).toMatch(/@grant\s+none/)
    expect(header).not.toMatch(/@(require|resource|connect|include|updateURL|downloadURL)\b/)
    expect(header).toMatch(/@author\s+wowayou/)
    expect(header).toMatch(/@license\s+MIT AND CC-BY-SA-4\.0/)
    expect(header).toContain('@noframes')
  })

  it.skipIf(!built)('许可：元数据与包声明一致，产物附带完整的项目 MIT 许可', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
    const license = readFileSync(join(root, 'LICENSE'), 'utf8').trim()
    const header = built.slice(0, built.indexOf('// ==/UserScript=='))
    expect(pkg.license).toBe('MIT AND CC-BY-SA-4.0')
    expect(lock.packages[''].license).toBe(pkg.license)
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[''].version).toBe(pkg.version)
    expect(header).toContain(`// @version      ${pkg.version}`)
    expect(header).toContain(`// @license      ${pkg.license}`)
    expect(built).toContain(license.split('\n').map(line => `// ${line}`).join('\n'))
  })

  it.skipIf(!built)('署名：产物附带 Preact 的 MIT 声明与 CC-CEDICT 的署名和许可', () => {
    const notice = built.slice(0, 6000)
    expect(notice).toContain('Copyright (c) 2015-present Jason Miller')
    expect(notice).toContain('The above copyright notice and this permission notice shall be')
    expect(notice).toContain('Paul Andrew Denisowski')
    expect(notice).toContain('CC BY-SA 4.0')
  })

  it.skipIf(!built)('兼容改写进入实际产物：不依赖 Array.at 或正则后行断言', () => {
    expect(built).not.toMatch(/\.at\s*\(|\(\?<[=!]/)
  })

  it.skipIf(!built)('产物里没有动态执行和外部地址（除命名空间与许可说明）', () => {
    expect(built).not.toMatch(/\beval\s*\(|new Function\s*\(/)
    const hosts = [...new Set([...built.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1]))].sort()
    expect(hosts.filter(h => !['cc-cedict.org', 'linux.do', 'meta.discourse.org', 'www.w3.org', 'creativecommons.org', 'github.com'].includes(h))).toEqual([])
  })
})
