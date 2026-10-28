import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,   // le prove di integrazione svuotano le stesse tabelle: un file alla volta
    env: { DATABASE_URL: 'postgres://test:test@localhost:5432/test' },
  },
});
