export {
  runBacktest,
  type BacktestMetrics,
  type BacktestOptions,
  type BacktestResult,
  type Candle,
  type Strategy,
  type StrategyAction,
  type StrategyContext,
  type Trade,
} from './backtest.js';
export { maxDrawdown, sharpe, totalReturn } from './metrics.js';
