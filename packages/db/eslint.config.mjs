import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";
import spacing from "../../eslint-spacing.config.mjs";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  spacing,
  globalIgnores(["node_modules/**", "dist/**"]),
]);
