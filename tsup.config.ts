import { env } from 'node:process'
import { defineConfig } from 'tsup'

export const DEV_MODE = env.NODE_ENV === 'development'

export default defineConfig({
  clean: true,
})
