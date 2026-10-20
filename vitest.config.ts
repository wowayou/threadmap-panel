import { defineConfig } from 'vitest/config'

/**
 * 性能预算按墙钟时间计时，和并行的 jsdom 测试抢 CPU 时会偶发超时。
 * 因此限制本地并发：功能测试最多两个 worker；性能文件逐个运行。
 * 保留原有超时与性能门槛，不靠延长预算掩盖极端输入或资源争用。
 */
export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/**/*.test.ts', 'acceptance/**/*.test.ts'], exclude: ['tests/perf*.test.ts'], sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: 'perf', include: ['tests/perf*.test.ts'], fileParallelism: false, sequence: { groupOrder: 1 } } },
    ],
  },
})
