// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

import { globalIgnores } from "eslint/config";

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  globalIgnores(["**/lib/**", "**/dst/**"]),
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
