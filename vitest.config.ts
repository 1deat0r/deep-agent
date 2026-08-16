import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@deep-agent\/(.+)$/,
        replacement: fileURLToPath(new URL('./packages/$1/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    testTimeout: 15000,
    hookTimeout: 15000,
    include: ['packages/**/test/**/*.test.ts'],
  },
});
