import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      all: true,
      include: ["webapp/static/**/*.js"],
      thresholds: {
        perFile: true,
        lines: 85,
      },
    },
  },
});
