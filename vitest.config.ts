import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@cleanvid/shared': path.resolve(rootDir, 'packages/shared/src/index.ts'),
      '@phosphor-icons-vue-icons': path.resolve(
        rootDir,
        'node_modules/@phosphor-icons/vue/dist/icons'
      )
    }
  },
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts'
    ]
  }
});
