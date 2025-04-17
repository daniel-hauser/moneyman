/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  testTimeout: 55_000,
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "./src",
  testMatch: ["**/test-scraper-access.ts"],
  moduleNameMapper: {
    "^(\\.\\.?\\/.+)\\.jsx?$": "$1",
  },
  reporters: [["github-actions", { silent: false }], "summary", "default"],
};
