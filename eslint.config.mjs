import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import imports from "eslint-plugin-import-x";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";
import ts from "typescript-eslint";

// Inspired by Expo Universe: correctness errors, advisory conventions, separate web/Node globals.
// Formatting stays with Vite Plus/Oxfmt; TypeScript checks module resolution and JSX names.
export default defineConfig([
  globalIgnores(["**/node_modules/", "**/dist/", "**/release/", ".nx/", "**/test-results/"]),
  {
    files: ["**/*.{js,cjs,mjs,ts,tsx}"],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: "latest" },
    plugins: { "import-x": imports },
    rules: {
      curly: ["warn", "all"],
      eqeqeq: ["warn", "smart"],
      "no-debugger": "warn",
      "no-eval": "warn",
      "no-var": "warn",
      "prefer-const": ["warn", { destructuring: "all", ignoreReadBeforeAssign: true }],
      "no-unused-vars": [
        "warn",
        { args: "none", ignoreRestSiblings: true, caughtErrorsIgnorePattern: "^_" },
      ],
      "import-x/first": "warn",
      "import-x/no-duplicates": "error",
      "import-x/order": [
        "warn",
        {
          groups: [["builtin", "external"], "internal", ["parent", "index", "sibling"]],
          "newlines-between": "always",
          alphabetize: { order: "asc" },
        },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: ts.parser },
    plugins: { "@typescript-eslint": ts.plugin },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { args: "none", ignoreRestSiblings: true, caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/array-type": ["warn", { default: "array" }],
      "@typescript-eslint/no-wrapper-object-types": "warn",
      "@typescript-eslint/no-extra-non-null-assertion": "warn",
      "@typescript-eslint/no-unused-expressions": [
        "warn",
        { allowShortCircuit: true, enforceForJSX: true },
      ],
    },
  },
  {
    files: ["apps/desktop/{host,scripts,tests}/**/*.{js,mjs,ts}", "apps/desktop/*.ts", "*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/desktop/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": hooks },
    rules: { "react-hooks/rules-of-hooks": "error" },
  },
]);
