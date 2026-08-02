import { defineConfig } from '@prisma/config'

export default defineConfig({
  earlyAccess: true,
  studio: {
    port: 5555,
  },
  migrate: {
    database: {
      url: process.env.DATABASE_URL,
    },
  },
})
