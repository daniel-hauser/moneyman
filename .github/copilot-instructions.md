# Moneyman - GitHub Copilot Instructions

## Project Scope and Priorities

Moneyman is a hobby, self-hosted TypeScript/Node.js app that scrapes financial transactions from Israeli banks and credit card companies and exports them to storage providers. Deployments are independently operated for small personal or household sets of logins, not a multi-tenant enterprise service with hostile operators.

- Protect secrets, privacy, transaction integrity, and normal operation. Match defensive logic to a concrete, plausible failure and proportionate impact and maintenance cost.
- Operator configuration is not a hostile tenant boundary, but guard against accidental unsafe filesystem operations. Preserve scraper domain filtering and configurable security policies.
- Prefer removing a problem through simpler design rather than layering defenses; for example, keep display labels separate from temporary-file identity.
- Do not add hypothetical-scale pagination or caps, exhaustive filename/digest collision namespaces, or retry/lifecycle scaffolding for theoretical problems.
- A valid review finding does not automatically justify a fix. Verify its relevance to this app; decline disproportionate proposals with a concrete rationale.

## Architecture and Configuration

- TypeScript strict mode and ES modules; source in `src/`, compiled JavaScript in `dst/`.
- Node.js version: see `engines.node` in [package.json](../package.json). Use npm.
- `patch-package` maintains dependency patches; Docker supports containerized deployments.

### Modules

- `src/index.ts` - Main entry point: scrape once and exit, or start the server with `MONEYMAN_LONG_RUNNING=true`
- `src/server.ts` - Long running mode: runs on the `options.scheduling.cron` schedule and handles Telegram commands
- `src/scraper/` - Bank scraping logic using israeli-bank-scrapers
- `src/bot/` - Data processing and messaging logic
- `src/bot/commands.ts` - Telegram command handlers for the long running mode
- `src/bot/bot.ts` - Shared Telegram polling lifecycle
- `src/bot/otp.ts` - OTP requests and reply matching
- `src/bot/storage/` - Storage providers; implement `StorageBase` when adding one
- `src/config.ts` - Configuration management with Zod validation
- `src/config.schema.ts` - Shared Zod configuration schemas and types
- `src/security/` - Security and domain filtering logic

### Configuration and Environment

- Configuration uses the `MONEYMAN_CONFIG` JSON format, loaded through `MONEYMAN_CONFIG`, `MONEYMAN_CONFIG_PATH`, or the existing secret-provider integration. Keep loading and validation in `src/config.ts` and shared schemas in `src/config.schema.ts`.
- `MONEYMAN_LONG_RUNNING=true` keeps running after the first scrape, with scheduling and Telegram commands.
- `DEBUG=moneyman:*` enables debug logging. Preserve namespace filters and company/account context; use Node's thread identity for `[main]` or `[worker n]`, not a mutable worker counter.
- Manage secrets through environment variables. See README for storage-provider-specific variables.
- Use the `debug` package for logging, Telegram for important events/errors, and structured error handling in storage providers.

### Dependencies and Integrations

- **israeli-bank-scrapers**: Core bank scraping; extend this integration when adding scrapers
- **puppeteer**: Headless Chrome scraping. The npm override aligns israeli-bank-scrapers' Puppeteer dependency with the top-level version. `src/scraper/index.ts` currently casts `browserContext` at the integration boundary for upstream type compatibility; reassess that workaround when upgrading rather than adding blanket casts.
- **zod**: Runtime type validation for configuration
- **telegraf**: Telegram bot integration for notifications
- **google-spreadsheet**: Google Sheets integration
- **ynab**: YNAB (You Need A Budget) integration

Storage providers include Google Sheets (service account authentication), YNAB, Azure Data Explorer, Buxfer, Actual Budget, Web Post (HTTP endpoint), and Local JSON (files).

## Implementation and Resource Ownership

- Make focused, complete changes: every edit must serve the task or closely related correctness. Avoid unrelated fixes, incidental renames, formatting churn, and refactors; a small diff is not a reason to leave the task incomplete.
- Keep README and other user-facing documentation focused on behavior and configuration, not task histories, validation results, or internal implementation journals.
- Keep necessary prerequisite refactors in separate commits from feature behavior. If new orchestration is needed around existing logic, preserve the original implementation's file and put the orchestration in a new file rather than relocating the old body.
- Prefer explicit parameters and per-run return values over global configuration access, singleton setters, and shared caches. Return worker metadata to its caller so concurrent workers cannot overwrite each other's state.
- Prefer type-narrowing `.filter()` for optional array entries over conditional spreads. Avoid redundant validation of fully controlled, typed internal results unless a concrete failure or trust boundary justifies it.
- Add coordination only when the behavior genuinely requires it. Then prefer scoped ownership and native primitives over custom active promises, progress chains, and lifecycle flags; minimize captured mutable state as well as module globals.
- When they simplify required coordination and are supported by the runtime, prefer native Web/Node APIs: `AbortController`, `AbortSignal.any()`/`timeout()`, abortable `events.once()`, `util.aborted()`, worker threads, `MessageChannel`, locks, and `AsyncDisposableStack`. Use a library such as Comlink only if it materially reduces needed communication boilerplate.
- Use signals for cancellation and lifetime failure, not ordinary completion. When a completion promise is needed, prefer `Promise.withResolvers()` to an outer captured resolver. Let `util.aborted()` resolve normally and handle timeout/cancellation at the operation boundary.
- Tie listeners to an owning cleanup signal where supported; ordinary EventEmitter `.on()` does not accept a signal. Inline one-use callbacks unless needed for removal. Use `try/finally` for cleanup and await in-flight shutdown before terminating a worker. Retain a shared close promise only when repeated closes need to await the same shutdown.

## Development and Validation

### Commands and Dependencies

```bash
npm ci                     # Install dependencies
npm start                  # Run the application
npm run build              # Build report assets and compile app/report TypeScript
npm run test               # Run Jest tests (pretest builds report assets)
npm run test:config        # Build and validate configuration
npm run test:scraper-access # Validate scraper connectivity
npm run lint               # Run lint:format and lint:commit
npm run lint:fix            # Auto-fix formatting
```

- Install/restore dependencies when needed for setup, after manifest changes, or when validation fails because dependencies are missing; do not reinstall routinely.
- Use `PUPPETEER_SKIP_DOWNLOAD=true` with development installs to skip Chrome download; CI uses Docker with system Chromium.
- For dependency updates, check breaking API changes (for example, Puppeteer major-version removals/renames). When combining Dependabot PRs, reference superseded PRs in the combined description.
- Husky and `pretty-quick` handle pre-commit formatting.

### Proportionate Tests

- Use Jest with `@swc/jest`, `jest.config.js`, and co-located `.test.ts` files in `src/` and `report/`. Preserve snapshots for message formatting and separate scraper-access suites.
- Base coverage on changed behavior and realistic risk, not line count. Add focused tests for meaningful new behavior or plausible regressions, ideally failing without the fix. A small diff does not excuse skipping important coverage; existing tests may already suffice.
- Reuse existing tests and helpers. Avoid elaborate scaffolding, coverage padding, constants/trivial accessors, framework behavior, internal implementation details, and exhaustive unsupported edge-case matrices.
- Prefer `jest-mock-extended` typed doubles (`mock<T>()`/`mockDeep<T>()`) over handwritten fake classes or unsafe assertions. Use plain typed objects for data fixtures without mocked behavior.
- Test worker behavior with normal Jest mocks; keep real-worker tests to thin boundary smoke checks, not custom module-loader hooks or fake browser/bank implementations.
- Run the smallest existing test/build/lint checks that cover the change; expand validation when results or realistic risk require it. Use `test:config` for configuration changes and scraper-access checks when connectivity validation is relevant.
- Documentation-only edits need no builds or tests unless documentation checks exist; verify formatting for the edited files.
- Never copy real reports, logs, credentials, or transaction data into source, fixtures, commits, or external services. Use entirely invented sample data.

### PR Scrape Testing

Wait for `PR Pipeline` to successfully publish the current PR head as `pr-<number>`, then dispatch `scrape.yml` with that `containerTag`, not `latest`. Keep `sendNewConfigToTg=false` unless explicitly requested.

## Commits and PR Titles

- Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages and PR titles: `type(scope)!: description` (scope and `!` are optional).
- Allowed types: `feat`, `fix`, `patch`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Prefer `fix` for bugs; `patch` is also supported.
- Use `ci` for workflow changes, `build` for build tooling, and `chore(deps)` / `chore(deps-dev)` for dependency updates. Do not use legacy `infra` or mixed-case types.
- Use optional scopes such as `scraper`, `telegram`, `report`, `config`, `ynab`, or `actual`. Keep descriptions lowercase and headers at most 200 characters.
- Mark breaking changes with `!` or a `BREAKING CHANGE:` footer. Preserve required co-author trailers.
- For code changes and before committing, run `npm run lint` locally; for documentation-only edits without a commit, checking the edited files' formatting suffices. Husky validates each new commit message; PR CI validates the PR title, not individual branch commits.
- Squash-merge PRs using the validated PR title as the commit title. Do not rewrite published history to rename old commits.
