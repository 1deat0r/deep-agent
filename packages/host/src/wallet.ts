import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { HostConfig } from './types.js';

/** Cost accounting for LLM usage (sovereign-agent ticket 03). */

export type WalletRates = HostConfig['wallet']['rates'];

export interface WalletOptions {
  budgetUsd: number;
  rates: WalletRates;
  /** JSONL spend file: one charge per line. */
  path: string;
}

export interface WalletCharge {
  costUsd: number;
  remainingUsd: number;
}

/** Uncountable spend must fail loud, never silently (missing rate, bad file). */
export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletError';
  }
}

/** Pure pricing: input/1e6 * inputPerMUsd + output/1e6 * outputPerMUsd. */
export function costUsd(model: string, inputTokens: number, outputTokens: number, rates: WalletRates): number {
  const rate = rates[model];
  if (!rate) throw new WalletError(`no rate for ${model}`);
  return (inputTokens / 1_000_000) * rate.inputPerMUsd + (outputTokens / 1_000_000) * rate.outputPerMUsd;
}

interface SpendLine {
  t: string;
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class Wallet {
  private readonly budgetUsd: number;
  private readonly rates: WalletRates;
  private readonly path: string;
  private spent = 0;

  constructor(options: WalletOptions) {
    this.budgetUsd = options.budgetUsd;
    this.rates = options.rates;
    this.path = options.path;
    this.spent = this.loadSpent();
  }

  private loadSpent(): number {
    if (!existsSync(this.path)) return 0;
    let total = 0;
    for (const line of readFileSync(this.path, 'utf8').trim().split('\n')) {
      if (line === '') continue;
      let parsed: SpendLine;
      try {
        parsed = JSON.parse(line) as SpendLine;
      } catch {
        throw new WalletError(`malformed wallet file ${this.path}`);
      }
      total += parsed.costUsd;
    }
    return total;
  }

  spentUsd(): number {
    return this.spent;
  }

  remainingUsd(): number {
    return this.budgetUsd - this.spent;
  }

  canRunTurn(): boolean {
    return this.remainingUsd() > 0;
  }

  charge(sessionId: string, model: string, inputTokens: number, outputTokens: number): WalletCharge {
    const cost = costUsd(model, inputTokens, outputTokens, this.rates);
    const line: SpendLine = {
      t: new Date().toISOString(),
      sessionId,
      model,
      inputTokens,
      outputTokens,
      costUsd: cost,
    };
    appendFileSync(this.path, `${JSON.stringify(line)}\n`);
    this.spent += cost;
    return { costUsd: cost, remainingUsd: this.remainingUsd() };
  }
}

/** Validate a merged wallet block at config load: numbers, non-negative budget. */
export function validateWallet(wallet: HostConfig['wallet']): void {
  if (typeof wallet !== 'object' || wallet === null) {
    throw new Error('wallet config must be an object');
  }
  const { budgetUsd, rates } = wallet as unknown as { budgetUsd: unknown; rates: unknown };
  if (typeof budgetUsd !== 'number' || !Number.isFinite(budgetUsd) || budgetUsd < 0) {
    throw new Error(`wallet.budgetUsd must be a non-negative number, got ${String(budgetUsd)}`);
  }
  if (typeof rates !== 'object' || rates === null || Array.isArray(rates)) {
    throw new Error('wallet.rates must be an object of model → { inputPerMUsd, outputPerMUsd }');
  }
  for (const [model, rate] of Object.entries(rates as Record<string, unknown>)) {
    const r = rate as { inputPerMUsd?: unknown; outputPerMUsd?: unknown } | null;
    if (typeof r !== 'object' || r === null) {
      throw new Error(`wallet.rates.${model} must be an object`);
    }
    for (const field of ['inputPerMUsd', 'outputPerMUsd'] as const) {
      const value = r[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`wallet.rates.${model}.${field} must be a non-negative number`);
      }
    }
  }
}
