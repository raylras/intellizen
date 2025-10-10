import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/node/extension.ts', 'src/node/langserver.ts'],
  outDir: 'dist/node',
  format: 'esm',
  external: ['vscode', 'jsonc-parser'],
  noExternal: () => true,
  loader: {
    '.dzs': 'text',
  },
})
