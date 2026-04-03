import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    env: { DATABASE_URL: 'postgres://test:test@localhost:5432/test' },
  },
});
