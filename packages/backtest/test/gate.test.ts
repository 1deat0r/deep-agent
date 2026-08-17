import { describe, expect, it } from 'vitest';
import { promotionGate } from '../src/backtest.js';
import type { BacktestResult, RegimeResult } from '../src/backtest.js';

function result(overrides: Partial<BacktestResult['metrics']>): BacktestResult {
  return {
    equityCurve: [100, 105],
    trades: [],
    metrics: {
      totalReturn: 0.05,
      benchmarkReturn: 0,
      sharpe: 1,
      maxDrawdown: -0.02,
      tradeCount: 40,
      ...overrides,
    },
  };
}

const bull: RegimeResult = { name: 'bull', result: result({ totalReturn: 0.25, benchmarkReturn: 0.15 }) };
const bear: RegimeResult = { name: 'bear', result: result({ totalReturn: 0.05, benchmarkReturn: -0.1 }) };

describe('promotionGate', () => {
  it('passes when every regime beats the benchmark with drawdown and trade minimums held', () => {
    const verdict = promotionGate([bull, bear]);
    expect(verdict.passed).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it('fails when a regime underperforms its benchmark', () => {
    const flat: RegimeResult = {
      name: 'flat',
      result: result({ totalReturn: 0.005, benchmarkReturn: 0.02 }),
    };
    const verdict = promotionGate([bull, flat]);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.some((r) => r.includes('flat') && r.includes('alpha'))).toBe(true);
  });

  it('fails when drawdown breaches the cap', () => {
    const crash: RegimeResult = {
      name: 'crash',
      result: result({ maxDrawdown: -0.35 }),
    };
    const verdict = promotionGate([bull, crash]);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.some((r) => r.includes('crash') && r.includes('drawdown'))).toBe(true);
  });

  it('fails when a regime has too few trades', () => {
    const thin: RegimeResult = { name: 'thin', result: result({ tradeCount: 10 }) };
    const verdict = promotionGate([bull, thin]);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.some((r) => r.includes('thin') && r.includes('trades'))).toBe(true);
  });

  it('fails when fewer than two regimes are supplied', () => {
    const verdict = promotionGate([bull]);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.some((r) => r.includes('regimes'))).toBe(true);
  });

  it('honors custom criteria', () => {
    const loose = promotionGate([bull, bear], { minTradesPerRegime: 1, minAlphaOverBenchmark: 0 });
    expect(loose.passed).toBe(true);
  });
});
