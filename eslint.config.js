// Expo's recommended rules (React, React Native, hooks, imports) plus TypeScript's type-checked
// strict rules, as in the web template.
const expoConfig = require("eslint-config-expo/flat");
const tseslint = require("typescript-eslint");
const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      "dist/*",
      "coverage/*",
      "reports/*",
      "pacts/*",
      ".expo/*",
      "android/*",
      "ios/*",
      "*.config.js",
      "expo-env.d.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: __dirname } },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      // React Native renders text, not HTML: apostrophes need no escaping.
      "react/no-unescaped-entities": "off",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "src/test/**"],
    rules: { "@typescript-eslint/unbound-method": "off", "@typescript-eslint/no-non-null-assertion": "off" },
  },
]);
