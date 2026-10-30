# Moneyman - GitHub Copilot Context

## Project Overview

Moneyman is a TypeScript/Node.js application that scrapes financial transaction data from Israeli banks and credit card companies, then exports the data to various storage providers like Google Sheets, YNAB, Azure Data Explorer, and others.

## Key Architecture Components

### Core Structure

- **Language**: TypeScript (compiled to JavaScript)
- **Runtime**: Node.js (see `engines.node` in [package.json](../package.json))
- **Package Manager**: npm
- **Build Output**: `dst/` directory
- **Source Code**: `src/` directory

### Main Modules

- `src/index.ts` - Main entry point: scrape once and exit, or start the server with `MONEYMAN_LONG_RUNNING=true`
- `src/server.ts` - Long running mode: runs on the `options.scheduling.cron` schedule and handles Telegram commands
- `src/scraper/` - Bank scraping logic using israeli-bank-scrapers
- `src/bot/` - Data processing and messaging logic
- `src/bot/commands.ts` - Telegram command handlers for the long running mode
- `src/bot/bot.ts` - Shared Telegram polling lifecycle
- `src/bot/otp.ts` - OTP requests and reply matching
- `src/bot/storage/` - Storage provider implementations (Google Sheets, YNAB, etc.)
- `src/config.ts` - Configuration management with Zod validation
- `src/security/` - Security and domain filtering logic

### Testing

- **Framework**: Jest with ts-jest
- **Config**: `jest.config.js` for regular tests
- **Location**: Test files are co-located with source files (`.test.ts` suffix)

## Development Workflow

### Setup

```bash
npm ci                    # Install dependencies
npm run build            # Compile TypeScript
npm run test             # Run all tests
npm run lint             # Check code formatting
npm run lint:fix         # Auto-fix formatting issues
```

### Key Scripts

- `npm start` - Run the application
- `npm run build` - TypeScript compilation
- `npm run test` - Run Jest tests
- `npm run test:config` - Test configuration validation
- `npm run test:scraper-access` - Test scraper connectivity

### Configuration

All configuration must use the `MONEYMAN_CONFIG` JSON format via `MONEYMAN_CONFIG` environment variable or `MONEYMAN_CONFIG_PATH` environment variable pointing to a JSON file.

## Key Dependencies

- **israeli-bank-scrapers**: Core bank scraping functionality
- **puppeteer**: Web scraping (headless Chrome) — top-level dependency, version may differ from the one bundled in israeli-bank-scrapers. When passing `BrowserContext` to israeli-bank-scrapers, a type assertion via `as unknown as ScraperOptionsWithBrowserContext["browserContext"]` is required.
- **zod**: Runtime type validation for configuration
- **telegraf**: Telegram bot integration for notifications
- **google-spreadsheet**: Google Sheets integration
- **ynab**: YNAB (You Need A Budget) integration

## Code Patterns & Standards

### Focused Changes and Lifecycle Ownership

- Minimize diffs: every changed file and edit must be necessary for the task or correctness. Defer unrelated fixes and avoid incidental renames, formatting churn, and refactors.
- Keep user-facing Markdown focused on behavior and configuration, not internal implementation details.
- Keep prerequisite refactors in separate commits from feature behavior. When adding orchestration around existing logic, preserve the original implementation's file and put the new orchestration in a new file rather than replacing and relocating the old body.
- Prefer explicit parameters and per-run return values over global configuration access, singleton setters, and shared caches. Return worker metadata to its caller so concurrent workers cannot overwrite each other's state.
- Minimize captured mutable lifecycle state, not just module globals. Prefer scoped resource ownership and native locks or signals over manually maintained active promises, progress chains, and lifecycle flags when they simplify the code.
- Prefer native Web and Node primitives such as `AbortController`, `AbortSignal.any()`/`timeout()`, abortable `events.once()`, `util.aborted()`, worker threads, `MessageChannel`, locks, and scoped disposal with `AsyncDisposableStack` over custom equivalents. Use focused libraries such as Comlink when they materially reduce communication boilerplate.
- Use signals for cancellation and lifetime failure, not ordinary completion. Use `Promise.withResolvers()` when a completion promise is needed instead of capturing a resolver in an outer variable. Let native `util.aborted()` resolve normally and handle timeout/cancellation at the operation boundary instead of mechanically recreating a rejecting helper.
- Tie listeners to an owning cleanup signal where supported; ordinary EventEmitter `.on()` does not accept a signal. Inline one-use callbacks when they are not needed for removal. Use `try/finally` for cleanup and await in-flight resource shutdown before terminating a worker; retain a shared close promise when repeated close calls would not await the original shutdown.
- Prefer type-narrowing `.filter()` for optional array entries over conditional spreads. Avoid redundant validation of fully controlled, typed internal results unless a concrete failure or trust boundary justifies it.
- Preserve existing debug namespace filters and company/account context. Include `[main]` or `[worker n]` using Node's thread identity rather than a mutable worker counter.

### Configuration

- Uses Zod schemas for runtime validation
- Configuration is centralized in `src/config.ts`

### Error Handling

- Uses debug package for logging (`moneyman:*` namespace)
- Telegram notifications for important events/errors
- Structured error handling in storage providers

### Testing

- Unit tests for core business logic
- Always prefer `jest-mock-extended` for typed test doubles: use `mock<T>()` or `mockDeep<T>()` instead of handwritten fake classes or unsafe type assertions. Use plain typed objects for data fixtures that do not need mocked behavior.
- Test worker behavior with normal Jest mocks; keep real-worker tests to thin boundary smoke checks rather than maintaining custom module-loader hooks and fake browser/bank implementations.
- Snapshot testing for message formatting
- Separate test suites for scraper access validation

### Security

- Domain-based request filtering for scrapers
- Configurable security policies
- Environment variable based secrets management

## Storage Providers

The application supports multiple storage backends:

- **Google Sheets**: Spreadsheet export with service account authentication
- **YNAB**: Budget application integration
- **Azure Data Explorer**: Enterprise data warehouse
- **Buxfer**: Personal finance management
- **Actual Budget**: Open-source budgeting tool
- **Web Post**: Generic HTTP endpoint
- **Local JSON**: File-based storage

## Development Notes

- TypeScript strict mode enabled
- ES modules used throughout
- Patch-package used for dependency patches
- Husky + pretty-quick for pre-commit formatting
- Docker support available for containerized deployment

## Environment Variables

Key environment variables include:

- `DEBUG=moneyman:*` - Enable debug logging
- `MONEYMAN_CONFIG` - JSON configuration (preferred)
- `MONEYMAN_LONG_RUNNING` - Set to `"true"` to keep running after the first scrape (schedule + Telegram commands)
- `PUPPETEER_SKIP_DOWNLOAD=true` - Skip Chrome download in development
- Various storage provider specific variables (see README.md)

## Common Development Tasks

1. **Adding a new storage provider**: Implement the `StorageBase` interface in `src/bot/storage/`
2. **Modifying configuration**: Update Zod schemas in `src/config.ts`
3. **Adding new scrapers**: Extend the israeli-bank-scrapers integration
4. **Testing changes**: Run `npm test` and validate with `npm run test:config`
5. **Updating dependencies**: Use `PUPPETEER_SKIP_DOWNLOAD=true` when running `npm install` on dev machines (CI uses Docker with system Chromium). When combining multiple dependabot PRs, check for breaking changes requiring code modifications (e.g., puppeteer major bumps remove/rename APIs). Reference superseded PRs in the combined PR description.
