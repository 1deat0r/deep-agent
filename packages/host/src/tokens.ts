import { createRequire } from 'node:module';

/**
 * Token counting for context budgeting. Uses js-tiktoken's cl100k_base
 * encoding (close enough to DeepSeek's tokenizer for budgeting; English prose
 * and code both track within a few percent), falling back to a chars/4
 * estimator if the encoding can't be loaded.
 */
let encoder: { encode: (text: string) => unknown[] } | null = null;
let encoderFailed = false;

function loadEncoder(): { encode: (text: string) => unknown[] } | null {
  if (encoder) return encoder;
  if (encoderFailed) return null;
  try {
    const require = createRequire(import.meta.url);
    const module = require('js-tiktoken') as { getEncoding?: (name: string) => unknown };
    const encoding = module.getEncoding?.('cl100k_base') as
      | { encode: (text: string) => unknown[] }
      | undefined;
    if (encoding) {
      encoder = encoding;
      return encoder;
    }
  } catch {
    // fall through to the estimator
  }
  encoderFailed = true;
  return null;
}

/** Estimate the number of tokens in a piece of text. */
export function estimateTokens(text: string): number {
  if (text === '') return 0;
  const encoding = loadEncoder();
  if (encoding) return encoding.encode(text).length;
  // chars/4 is a serviceable estimator for mixed prose and code.
  return Math.ceil(text.length / 4);
}
