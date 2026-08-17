import { describe, expect, it } from 'vitest';
import { runBacktest } from '../src/backtest.js';
import type { Candle, Strategy } from '../src/backtest.js';

/** 10 straight up-days, $1/day: deterministic trend with no noise. */
const TREND: Candle[] = Array.from({ length: 10 }, (_, i) => {
  const open = 100 + i;
  return { date: `d${i}`, open, high: open + 0.5, low: open - 0.5, close: open + 1 };
});

const buyAndHold: Strategy = (ctx) =>
  ctx.index === 0 ? { action: 'buy', fraction: 1 } : { action: 'hold' };

describe('runBacktest', () => {
  it('matches buy-and-hold on a clean trend, net of costs', () => {
    const result = runBacktest({ candles: TREND, strategy: buyAndHold });
    // Benchmark: close[9] / close[0] - 1 = 110 / 101 - 1 ≈ 0.0891
    expect(result.metrics.benchmarkReturn).toBeCloseTo(110 / 101 - 1, 10);
    // Costs (fee + slippage on one buy) leave the strategy slightly below benchmark.
    expect(result.metrics.totalReturn).toBeLessThan(result.metrics.benchmarkReturn);
    expect(result.metrics.totalReturn).toBeCloseTo(result.metrics.benchmarkReturn, 1);
    expect(result.metrics.tradeCount).toBe(1);
    expect(result.equityCurve).toHaveLength(TREND.length);
  });

  it('passes the strategy only the history up to the current candle (no lookahead)', () => {
    const spy: Strategy = (ctx) => {
      expect(ctx.history).toHaveLength(ctx.index + 1);
      expect(ctx.history[ctx.index]?.close).toBe(ctx.candle.close);
      return { action: 'hold' };
    };
    const result = runBacktest({ candles: TREND, strategy: spy });
    expect(result.metrics.tradeCount).toBe(0);
  });

  it('executes at the next open with slippage and fee applied', () => {
    let buyPrice = 0;
    const strategy: Strategy = (ctx) => {
      if (ctx.index === 0) {
        return { action: 'buy', fraction: 1 };
      }
      return { action: 'hold' };
    };
    const result = runBacktest({ candles: TREND, strategy, feeBps: 10, slippageBps: 20 });
    // Buy decided at close of d0 (=101) fills at open of d1 (=101) + 20bps slippage = 101.202
    buyPrice = result.trades[0]?.price ?? 0;
    expect(buyPrice).toBeCloseTo(101 * (1 + 20 / 10_000), 10);
    expect(result.trades[0]?.fee).toBeGreaterThan(0);
    expect(result.trades[0]?.side).toBe('buy');
  });

  it('sells out and stops trading when the strategy flips', () => {
    const flip: Strategy = (ctx) => {
      if (ctx.index <= 1) return { action: 'buy', fraction: 1 };
      if (ctx.index === 2) return { action: 'sell', fraction: 1 };
      return { action: 'hold' };
    };
    const result = runBacktest({ candles: TREND, strategy: flip });
    expect(result.metrics.tradeCount).toBe(2);
    expect(result.trades.map((t) => t.side)).toEqual(['buy', 'sell']);
    // After selling out on a rising trend, return lags the benchmark.
    expect(result.metrics.totalReturn).toBeLessThan(result.metrics.benchmarkReturn);
  });

  it('handles a flat or single-candle series without throwing', () => {
    const single = runBacktest({ candles: [TREND[0]!], strategy: buyAndHold });
    expect(single.metrics.totalReturn).toBe(0);
    expect(single.metrics.benchmarkReturn).toBe(0);
  });
});
