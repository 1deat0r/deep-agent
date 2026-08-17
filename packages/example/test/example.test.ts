import { describe, expect, it } from 'vitest';
import { exampleGreeting } from '../src/index.js';

describe('example deep module', () => {
  it('exposes behaviour through its entry point', () => {
    expect(exampleGreeting('agent')).toBe('Hello, agent — from deep inside example/lib.');
  });
});
