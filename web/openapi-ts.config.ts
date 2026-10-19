import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../contracts/openapi.json",
  output: "src/lib/backend/generated",
  plugins: ["@hey-api/typescript", "@hey-api/sdk", "@hey-api/client-fetch"],
});
