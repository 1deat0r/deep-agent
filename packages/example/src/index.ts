import { greet } from './lib/impl.js';

/** Example deep-module entry point: a small interface; the behaviour lives in lib/. */
export function exampleGreeting(name: string): string {
  return greet(name);
}
