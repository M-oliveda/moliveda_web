import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

const TS_FILES = ["**/*.{ts,tsx,mts,cts}"];
const TEST_FILES = ["**/*.test.{ts,tsx}", "e2e/**", "src/test/**"];

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  // Type-checked rules for TypeScript (MASTERPLAN section 6).
  {
    files: TS_FILES,
    extends: [
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "interface", format: ["PascalCase"], prefix: ["I"] },
      ],
    },
  },

  // Project-wide rules.
  {
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
            "type",
          ],
          pathGroups: [{ pattern: "@/**", group: "internal" }],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      // Personal content is read only through src/i18n/content.ts (D26).
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/messages/*/content/**"],
              message: "Read personal content through @/i18n/content.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/i18n/content.ts"],
    rules: { "no-restricted-imports": "off" },
  },

  // Every user-facing string goes through next-intl.
  {
    files: ["src/components/**/*.tsx", "src/features/**/*.tsx"],
    ignores: TEST_FILES,
    rules: {
      "react/jsx-no-literals": [
        "error",
        { noStrings: true, ignoreProps: true },
      ],
    },
  },

  // Architecture boundaries (MASTERPLAN section 6).
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/legacy-templates": false,
      "boundaries/elements": [
        { type: "app", pattern: "src/app" },
        { type: "ui", pattern: "src/components/ui" },
        { type: "layout", pattern: "src/components/layout" },
        {
          type: "feature",
          pattern: "src/features/*",
          capture: ["featureName"],
        },
        { type: "i18n", pattern: "src/i18n" },
        { type: "lib", pattern: "src/lib" },
        { type: "types", pattern: "src/types" },
        { type: "test", pattern: "src/test" },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          policies: [
            {
              from: { element: { type: "ui" } },
              disallow: {
                to: {
                  element: { types: ["app", "layout", "feature", "i18n"] },
                },
              },
              message: "ui components import only ui, lib and types.",
            },
            {
              from: { element: { type: "feature" } },
              disallow: {
                to: {
                  element: {
                    type: "feature",
                    captured: {
                      featureName: "!{{ from.element.captured.featureName }}",
                    },
                  },
                },
              },
              message: "Features do not import other features.",
            },
            {
              from: { element: { types: ["lib", "i18n", "types"] } },
              disallow: {
                to: {
                  element: { types: ["app", "ui", "layout", "feature"] },
                },
              },
              message: "lib, i18n and types do not import UI or routes.",
            },
            {
              from: {
                element: {
                  types: ["app", "ui", "layout", "feature", "i18n", "lib"],
                },
              },
              disallow: { to: { element: { type: "test" } } },
              message: "src/test is for tests only.",
            },
          ],
        },
      ],
    },
  },

  // Tests may use the test helpers and relax a few production-only rules.
  {
    files: TEST_FILES,
    rules: {
      "boundaries/dependencies": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },

  // Plain JavaScript config files are not part of the TypeScript project.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    ".lighthouseci/**",
    "next-env.d.ts",
  ]),
]);
