/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "./src",
  setupFilesAfterEnv: ["<rootDir>/../jest.setup.ts"],
  moduleNameMapper: {
    "^(\\.\\.?\\/.+)\\.jsx?$": "$1",
  },
  reporters: ["default", ["github-actions", { silent: false }], "summary"],
};
