import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

config({ path: '.env.test' });

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['__tests__/**/*.test.ts'],
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
    },
  },
});
