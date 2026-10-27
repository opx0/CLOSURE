import { expect, test } from 'bun:test'
import { byteLimit, memoryBudget } from './runtime-budget.ts'

test('container headroom wins over host memory and unknown usage stays unknown', () => {
  expect(memoryBudget(16_000, 12_000, 8_000, 7_000).effectiveAvailableBytes).toBe(1_000)
  expect(memoryBudget(16_000, 12_000, 8_000, 9_000).effectiveAvailableBytes).toBe(0)
  expect(memoryBudget(16_000, 12_000, 8_000, null).effectiveAvailableBytes).toBeNull()
  expect(memoryBudget(16_000, 12_000, null, null).effectiveTotalBytes).toBe(16_000)
  for (const value of ['', 'max', '-1', 'Infinity', '1.5']) expect(byteLimit(value)).toBeNull()
  expect(byteLimit('8589934592\n')).toBe(8589934592)
})
