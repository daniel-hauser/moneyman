export default {
  extends: ["@commitlint/config-conventional"],
  defaultIgnores: false,
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "patch",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
  },
};
