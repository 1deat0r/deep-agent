import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { costUsd, Wallet, WalletError } from '../src/wallet.js';

const RATES = {
  'model-a': { inputPerMUsd: 0.27, outputPerMUsd: 1.1 },
};

describe('costUsd', () => {
  it('prices input and output tokens at the model rate', () => {
    expect(costUsd('model-a', 1_000_000, 1_000_000, RATES)).toBeCloseTo(0.27 + 1.1, 10);
  });

  it('prices partial millions proportionally', () => {
    expect(costUsd('model-a', 500_000, 0, RATES)).toBeCloseTo(0.135, 10);
  });

  it('throws WalletError when the model has no rate', () => {
    expect(() => costUsd('model-z', 1, 1, RATES)).toThrowError(WalletError);
    expect(() => costUsd('model-z', 1, 1, RATES)).toThrowError(/no rate for model-z/);
  });
});

describe('Wallet', () => {
  let root: string;
  let path: string;
  const walletArgs = (budgetUsd = 5) => ({ budgetUsd, rates: RATES, path });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'deep-agent-wallet-'));
    path = join(root, 'wallet.json');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('starts at zero spent with the full budget remaining', () => {
    const wallet = new Wallet(walletArgs());
    expect(wallet.budgetUsd()).toBe(5);
    expect(wallet.spentUsd()).toBe(0);
    expect(wallet.remainingUsd()).toBe(5);
    expect(wallet.canRunTurn()).toBe(true);
  });

  it('charges a turn and appends a JSONL line', () => {
    const wallet = new Wallet(walletArgs());
    const result = wallet.charge('s1', 'model-a', 1_000_000, 0);
    expect(result.costUsd).toBeCloseTo(0.27, 10);
    expect(result.remainingUsd).toBeCloseTo(5 - 0.27, 10);

    const lines = readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      sessionId: 's1',
      model: 'model-a',
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(lines[0]?.costUsd).toBeCloseTo(0.27, 10);
    expect(typeof lines[0]?.t).toBe('string');
  });

  it('reloads accumulated spend from an existing file', () => {
    writeFileSync(
      path,
      `${JSON.stringify({
        t: '2026-08-17T00:00:00.000Z',
        sessionId: 's1',
        model: 'model-a',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 1.5,
      })}\n`,
    );
    const wallet = new Wallet(walletArgs());
    expect(wallet.spentUsd()).toBeCloseTo(1.5, 10);
    expect(wallet.remainingUsd()).toBeCloseTo(3.5, 10);
  });

  it('canRunTurn is false once the budget is exhausted', () => {
    const wallet = new Wallet(walletArgs());
    wallet.charge('s1', 'model-a', 100_000_000, 0); // 27 USD — overshoots the 5 USD budget
    expect(wallet.remainingUsd()).toBeLessThan(0);
    expect(wallet.canRunTurn()).toBe(false);
  });

  it('canRunTurn is false for a zero budget', () => {
    expect(new Wallet(walletArgs(0)).canRunTurn()).toBe(false);
  });

  it('setBudgetUsd tops up the budget and rejects negative values', () => {
    const wallet = new Wallet(walletArgs());
    wallet.charge('s1', 'model-a', 1_000_000, 0); // spent 0.27
    wallet.setBudgetUsd(10);
    expect(wallet.budgetUsd()).toBe(10);
    expect(wallet.remainingUsd()).toBeCloseTo(10 - 0.27, 10);
    expect(wallet.canRunTurn()).toBe(true);
    expect(() => wallet.setBudgetUsd(-1)).toThrowError(/budget/);
  });

  it('charge throws WalletError when the model has no rate', () => {
    const wallet = new Wallet(walletArgs());
    expect(() => wallet.charge('s1', 'model-z', 1, 1)).toThrowError(WalletError);
  });

  it('load throws on a malformed wallet file', () => {
    writeFileSync(path, 'not json\n');
    expect(() => new Wallet(walletArgs())).toThrowError(/wallet/);
  });
});
