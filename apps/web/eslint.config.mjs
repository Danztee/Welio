import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import spacing from "../../eslint-spacing.config.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  spacing,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
