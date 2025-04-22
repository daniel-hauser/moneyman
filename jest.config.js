/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/src/**/*.test.ts"],
  rootDir: "./packages",
  transformIgnorePatterns: ["<rootDir>/node_modules/@moneyman"],
  reporters: [["github-actions", { silent: false }], "summary", "default"],
};
