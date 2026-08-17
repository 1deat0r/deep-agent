/** Private implementation — reachable only through the src/ entry points. */
export function greet(name: string): string {
  return `Hello, ${name} — from deep inside example/lib.`;
}
