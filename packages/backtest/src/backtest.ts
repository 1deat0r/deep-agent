// Cost-aware, lookahead-proof backtest engine (sovereign-agent ticket 06):
// the strategy sees only the candle history up to "today", decides at the
// close, and fills at the next open with slippage and fees modeled.
import { maxDrawdown, sharpe, totalReturn } from './metrics.js';

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type StrategyAction = {
  action: 'buy' | 'sell' | 'hold';
  /** Fraction of cash (buy) or of the position (sell); defaults to 1. */
  fraction?: number;
};

export interface StrategyContext {
  index: number;
  candle: Candle;
  /** candles[0..index] only — the future is not in this array. */
  history: Candle[];
  /** Position value / equity at the current close. */
  positionPct: number;
  cash: number;
  equity: number;
}

export type Strategy = (ctx: StrategyContext) => StrategyAction;

export interface BacktestOptions {
  candles: Candle[];
  strategy: Strategy;
  initialCapital?: number;
  /** Per-side commission in basis points. */
  feeBps?: number;
  /** Fill-price cost in basis points (buy up, sell down). */
  slippageBps?: number;
}

export interface Trade {
  date: string;
  side: 'buy' | 'sell';
  shares: number;
  price: number;
  fee: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  benchmarkReturn: number;
  sharpe: number;
  maxDrawdown: number;
  tradeCount: number;
}

export interface BacktestResult {
  equityCurve: number[];
  trades: Trade[];
  metrics: BacktestMetrics;
}

export function runBacktest(options: BacktestOptions): BacktestResult {
  const { candles, strategy } = options;
  const initialCapital = options.initialCapital ?? 10_000;
  const feeBps = options.feeBps ?? 5;
  const slippageBps = options.slippageBps ?? 10;

  let cash = initialCapital;
  let shares = 0;
  const equityCurve: number[] = [];
  const trades: Trade[] = [];

  const mark = (price: number): number => cash + shares * price;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    // Decide at the close, seeing only history through i.
    const equity = mark(candle.close);
    equityCurve.push(equity);
    if (i === candles.length - 1) break; // last candle: no next open to fill at
    const positionPct = equity === 0 ? 0 : (shares * candle.close) / equity;
    const action = strategy({
      index: i,
      candle,
      history: candles.slice(0, i + 1),
      positionPct,
      cash,
      equity,
    });

    const next = candles[i + 1]!;
    if (action.action === 'buy' && cash > 0) {
      const fraction = action.fraction ?? 1;
      const price = next.open * (1 + slippageBps / 10_000);
      const spend = cash * Math.min(Math.max(fraction, 0), 1);
      const bought = spend / price;
      const fee = spend * (feeBps / 10_000);
      cash -= spend + fee;
      shares += bought;
      trades.push({ date: next.date, side: 'buy', shares: bought, price, fee });
    } else if (action.action === 'sell' && shares > 0) {
      const fraction = action.fraction ?? 1;
      const price = next.open * (1 - slippageBps / 10_000);
      const sold = shares * Math.min(Math.max(fraction, 0), 1);
      const proceeds = sold * price;
      const fee = proceeds * (feeBps / 10_000);
      cash += proceeds - fee;
      shares -= sold;
      trades.push({ date: next.date, side: 'sell', shares: sold, price, fee });
    }
  }

  const benchmarkReturn =
    candles.length >= 2 && candles[0]!.close > 0
      ? candles[candles.length - 1]!.close / candles[0]!.close - 1
      : 0;
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!;
    if (prev > 0) returns.push(equityCurve[i]! / prev - 1);
  }

  return {
    equityCurve,
    trades,
    metrics: {
      totalReturn: totalReturn(equityCurve),
      benchmarkReturn,
      sharpe: sharpe(returns),
      maxDrawdown: maxDrawdown(equityCurve),
      tradeCount: trades.length,
    },
  };
}

export interface GateCriteria {
  /** Minimum number of regimes that must each pass. */
  minRegimes?: number;
  /** Minimum executed trades per regime (default 30; ticket 06 asks ≥60 total). */
  minTradesPerRegime?: number;
  /** Drawdown cap: the regime's drawdown must not be deeper than this (default -0.2). */
  maxDrawdown?: number;
  /** Minimum net alpha over the benchmark per regime (default 0.01 = 1%). */
  minAlphaOverBenchmark?: number;
}

export interface RegimeResult {
  name: string;
  result: BacktestResult;
}

export interface GateVerdict {
  passed: boolean;
  reasons: string[];
}

/**
 * The paper-trading promotion gate (ticket 06): every regime must beat its
 * benchmark net of modeled costs, hold the drawdown cap, and trade enough for
 * the result to be meaningful. Returns a verdict with per-regime reasons.
 */
export function promotionGate(
  regimes: RegimeResult[],
  criteria: GateCriteria = {},
): GateVerdict {
  const minRegimes = criteria.minRegimes ?? 2;
  const minTradesPerRegime = criteria.minTradesPerRegime ?? 30;
  const maxDrawdown = criteria.maxDrawdown ?? -0.2;
  const minAlphaOverBenchmark = criteria.minAlphaOverBenchmark ?? 0.01;

  const reasons: string[] = [];
  if (regimes.length < minRegimes) {
    reasons.push(`needs at least ${minRegimes} regimes, got ${regimes.length}`);
  }
  for (const { name, result } of regimes) {
    const alpha = result.metrics.totalReturn - result.metrics.benchmarkReturn;
    if (alpha < minAlphaOverBenchmark) {
      reasons.push(
        `${name}: net alpha ${alpha.toFixed(4)} below required ${minAlphaOverBenchmark}`,
      );
    }
    if (result.metrics.maxDrawdown < maxDrawdown) {
      reasons.push(
        `${name}: drawdown ${result.metrics.maxDrawdown.toFixed(4)} deeper than cap ${maxDrawdown}`,
      );
    }
    if (result.metrics.tradeCount < minTradesPerRegime) {
      reasons.push(
        `${name}: ${result.metrics.tradeCount} trades below required ${minTradesPerRegime}`,
      );
    }
  }
  return { passed: reasons.length === 0, reasons };
}
