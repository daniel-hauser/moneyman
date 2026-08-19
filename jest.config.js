/** @type {import('jest').Config} */
export default {
  transform: {
    "^.+\\.[cm]?[tj]sx?$": [
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
  transformIgnorePatterns: [
    "node_modules/(?!(@mswjs/interceptors|@open-draft/until|rettime)/)",
  ],
  testEnvironment: "node",
  rootDir: "./src",
  moduleNameMapper: {
    "^(\\.\\.?\\/.+)\\.jsx?$": "$1",
  },
  reporters: ["default", ["github-actions", { silent: false }], "summary"],
};
