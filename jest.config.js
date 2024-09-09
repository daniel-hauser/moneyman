/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "./src",
  moduleNameMapper: {
    "^(\\.\\.?\\/.+)\\.jsx?$": "$1",
  },
};
