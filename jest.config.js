/**
 * unit: everything under src/ on the iOS-like React Native preset, with coverage (VX-11: 90%).
 * contract: the Pact consumer tests, in Node (they start a mock provider on a local port).
 */
const ignoreNative =
  "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@openfeature/.*))";

/** @type {import('jest').Config} */
module.exports = {
  reporters: ["default", ["jest-junit", { outputDirectory: "reports", outputName: "junit.xml" }]],
  coverageReporters: ["text-summary", "json-summary", "lcov"],
  coverageThreshold: { global: { lines: 90, statements: 90, functions: 90, branches: 80 } },
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
    "!src/test/**",
    // Thin bindings to native modules: covered on devices by the Maestro flows.
    "!src/app/**",
    "!src/services.ts",
    "!src/outbox/sqlite.ts",
    "!src/auth/vault.ts",
  ],
  projects: [
    {
      displayName: "unit",
      preset: "jest-expo/ios",
      testMatch: ["<rootDir>/src/**/*.test.ts?(x)"],
      testPathIgnorePatterns: ["\\.pact\\.test\\."],
      setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
      transformIgnorePatterns: [ignoreNative],
    },
    {
      displayName: "contract",
      preset: "jest-expo/node",
      testMatch: ["<rootDir>/src/**/*.pact.test.ts"],
      transformIgnorePatterns: [ignoreNative],
      testTimeout: 30000,
    },
  ],
};
