import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false,
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**"],
    env: {
      VALOR_DB_PATH: "./data/valor-test.db",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
