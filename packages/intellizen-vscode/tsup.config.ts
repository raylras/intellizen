import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/node/extension.ts', 'src/node/langserver.ts'],
  outDir: 'dist/node',
  format: 'cjs',
  sourcemap: true,
  minify: true,
  external: ['vscode'],
  noExternal: [/^(?!vscode$)/],
})
