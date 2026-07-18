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
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.test.json",
      },
    ],
  },
  roots: ["<rootDir>/apps", "<rootDir>/packages"],
  moduleNameMapper: {
    "^(\\.\\.?\\/.+)\\.jsx?$": "$1",
  },
  reporters: ["default", ["github-actions", { silent: false }], "summary"],
};
