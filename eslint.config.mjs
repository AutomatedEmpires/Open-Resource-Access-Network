import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import oranPlugin from "./eslint-plugin-oran.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // Type augmentation files often require `any` to match upstream generics.
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Tests often need flexible mocking/types; allow `any` there
  // and ignore _-prefixed args used only for documentation clarity.
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    },
  },

  // Enforce design-token usage — warn on arbitrary Tailwind values not in the
  // approved list documented in docs/ui/UI_UX_TOKENS.md §11.
  // NOTE: eslint-plugin-tailwindcss requires Tailwind v3; this project uses v4.
  //       The local `eslint-plugin-oran` rule achieves the same goal without
  //       depending on Tailwind internals, and is Tailwind-version agnostic.
  {
    plugins: { oran: oranPlugin },
    rules: {
      "oran/no-unapproved-arbitrary": "warn",
    },
  },
]);

export default eslintConfig;
