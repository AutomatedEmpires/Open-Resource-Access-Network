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
    // Build / generated output:
    "dist/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),

  // Allow _-prefixed args/vars to signal intentionally unused parameters
  // (e.g. required positional params in route handlers, destructured rest).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "destructuredArrayIgnorePattern": "^_",
      }],
    },
  },

  // Type augmentation files often require `any` to match upstream generics.
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Tests often need flexible mocking/types; allow `any` there.
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
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
