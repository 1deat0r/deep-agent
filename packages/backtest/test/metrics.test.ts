import { describe, expect, it } from 'vitest';
import { maxDrawdown, sharpe, totalReturn } from '../src/metrics.js';

describe('totalReturn', () => {
  it('computes gain and loss from an equity curve', () => {
    expect(totalReturn([100, 110])).toBeCloseTo(0.1, 10);
    expect(totalReturn([100, 90])).toBeCloseTo(-0.1, 10);
  });

  it('returns 0 for empty or single-point curves', () => {
    expect(totalReturn([])).toBe(0);
    expect(totalReturn([100])).toBe(0);
  });
});

describe('maxDrawdown', () => {
  it('computes the largest peak-to-trough decline', () => {
    expect(maxDrawdown([100, 120, 90, 110])).toBeCloseTo(90 / 120 - 1, 10);
  });

  it('is 0 when equity never declines', () => {
    expect(maxDrawdown([100, 101, 105])).toBe(0);
  });

  it('is 0 for empty or single-point curves', () => {
    expect(maxDrawdown([])).toBe(0);
    expect(maxDrawdown([100])).toBe(0);
  });
});

describe('sharpe', () => {
  it('is 0 when returns have no variance', () => {
    expect(sharpe([0.01, 0.01, 0.01])).toBe(0);
  });

  it('annualizes a worked example', () => {
    // returns [0.02, -0.01, 0.03]: mean 0.013333, population std 0.016997
    // sharpe = 0.013333 / 0.016997 * sqrt(252) ≈ 12.45
    expect(sharpe([0.02, -0.01, 0.03])).toBeCloseTo(12.45, 2);
  });

  it('is 0 for empty or single-return lists', () => {
    expect(sharpe([])).toBe(0);
    expect(sharpe([0.05])).toBe(0);
  });
});
