import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

const externalNodeBuiltins = ['electron', /^node:/];

export default defineConfig({
  base: './',
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: { external: externalNodeBuiltins },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: externalNodeBuiltins,
              output: { format: 'cjs', entryFileNames: '[name].cjs' },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
});
