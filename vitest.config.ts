import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    reporters: "default",
  },
  resolve: {
    alias: {
      "@": path.resolve(root),
    },
  },
})
