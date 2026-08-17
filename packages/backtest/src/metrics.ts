/** Pure performance metrics over an equity curve (sovereign-agent ticket 06). */

export function totalReturn(equity: number[]): number {
  if (equity.length < 2) return 0;
  const first = equity[0];
  const last = equity[equity.length - 1];
  if (first === undefined || last === undefined || first === 0) return 0;
  return last / first - 1;
}

export function maxDrawdown(equity: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const value of equity) {
    if (value > peak) peak = value;
    if (peak > 0) {
      const drawdown = value / peak - 1;
      if (drawdown < worst) worst = drawdown;
    }
  }
  return worst;
}

export function sharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) * (r - mean), 0) / returns.length;
  if (variance === 0) return 0;
  return (mean / Math.sqrt(variance)) * Math.sqrt(252);
}
