export default {
  extends: ["@commitlint/config-conventional"],
  defaultIgnores: false,
  rules: {
    "header-max-length": [2, "always", 200],
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
