import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: 'esm',
  esbuildOptions(options) {
    options.loader = {
      ...options.loader,
      '.dzs': 'text',
    }
  },
})
