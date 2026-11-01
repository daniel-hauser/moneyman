/** @type {import('jest').Config} */
export default {
  transform: {
    "^.+\\.tsx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: {
            syntax: "typescript",
          },
          target: "es2022",
        },
        module: {
          type: "commonjs",
        },
      },
    ],
  },
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/report"],
  moduleNameMapper: {
    "^(?:\\./(?:report/)?|\\.\\./src/bot/report/)assets\\.generated\\.js$":
      "<rootDir>/dst/bot/report/assets.generated.js",
    "^(\\.\\.?\\/.+)\\.jsx?$": "$1",
  },
  reporters: ["default", ["github-actions", { silent: false }], "summary"],
};
