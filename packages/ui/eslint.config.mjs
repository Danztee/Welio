import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import spacing from "../../eslint-spacing.config.mjs";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  spacing,
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  globalIgnores(["node_modules/**", "dist/**"]),
]);
