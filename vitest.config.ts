import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // `server-only` throws on import outside server contexts. Vitest runs
      // modules directly in Node, so alias to a no-op to keep server-marked
      // modules unit-testable.
      'server-only': resolve(__dirname, './tests/_mocks/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Exclude agent worktrees + standard build artifacts. Agent worktrees
    // live under `.claude/worktrees/` while parallel sub-agents are running;
    // their tests reference paths that may not yet exist in the main tree.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.claude/**'],
    // RLS tests run sequentially against a real Supabase project. Keep one fork
    // for safety; once the test DB is on a per-PR ephemeral Supabase branch we
    // can parallelize.
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
