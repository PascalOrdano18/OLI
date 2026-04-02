import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// @anthropic-ai/claude-code ships only cli.js with no package.json "exports"
// field, so Vite cannot auto-resolve it by bare package name.
// Use require.resolve to locate cli.js at install time.
const _require = createRequire(import.meta.url);
const claudeCodeEntry = _require.resolve("@anthropic-ai/claude-code/cli.js");

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // Point the bare package specifier to cli.js so Vite can resolve it.
      // In tests the module is always vi.mock'd so cli.js never executes.
      "@anthropic-ai/claude-code": claudeCodeEntry,
    },
  },
});
