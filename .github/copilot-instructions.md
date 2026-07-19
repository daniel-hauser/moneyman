# Moneyman - GitHub Copilot Context

## Project Overview

Moneyman is a TypeScript/Node.js application that scrapes financial transaction data from Israeli banks and credit card companies, then exports the data to various storage providers like Google Sheets, YNAB, Azure Data Explorer, and others.

## Key Architecture Components

### Core Structure

- **Language**: TypeScript executed through `tsx`
- **Runtime**: Node.js 25
- **Package Manager**: pnpm workspaces
- **Build**: `tsc --noEmit` typechecking; no compiled output directory
- **Source Code**: `apps/` and `packages/`

### Main Modules

- `apps/config-init/` - Networkless legacy-config splitter
- `apps/egress/` - Per-boundary allowlist proxy
- `apps/scraper/` - Credential-bearing bank scraper and Chromium
- `apps/exporter/` - Storage provider implementations
- `apps/notifier/` - Telegram notifications, OTP, screenshots, and private logs
- `packages/common/` - Shared dependency-light utilities
- `packages/protocol/` - Zod configuration and authenticated IPC schemas

### Testing

- **Framework**: Jest with ts-jest
- **Config**: `jest.config.js` for regular tests
- **Location**: Test files are co-located with source files (`.test.ts` suffix)

## Development Workflow

### Setup

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm lint:fix
```

### Key Scripts

- `pnpm start` - Run the scraper application
- `pnpm build` - Typecheck the workspace
- `pnpm test` - Run Jest tests
- `pnpm test:config` - Test configuration validation
- `pnpm test:scraper-access` - Test scraper connectivity

### Configuration

Legacy `MONEYMAN_CONFIG` and `MONEYMAN_CONFIG_PATH` remain supported. In Docker, the networkless config initializer splits them into least-privilege service files and authentication tokens.

## Key Dependencies

- **israeli-bank-scrapers**: Core bank scraping functionality
- **puppeteer**: Web scraping (headless Chrome) — top-level dependency, version may differ from the one bundled in israeli-bank-scrapers. When passing `BrowserContext` to israeli-bank-scrapers, a type assertion via `as unknown as ScraperOptionsWithBrowserContext["browserContext"]` is required.
- **zod**: Runtime type validation for configuration
- **telegraf**: Telegram bot integration for notifications
- **google-spreadsheet**: Google Sheets integration
- **ynab**: YNAB (You Need A Budget) integration

## Code Patterns & Standards

### Configuration

- Uses Zod schemas for runtime validation
- Configuration schemas and splitting are centralized in `packages/protocol/src/config.schema.ts`

### Error Handling

- Uses debug package for logging (`moneyman:*` namespace)
- Telegram notifications for important events/errors
- Structured error handling in storage providers

### Testing

- Unit tests for core business logic
- Mock-based testing with `jest-mock-extended`
- Snapshot testing for message formatting
- Separate test suites for scraper access validation

### Security

- Application containers use internal Docker networks and policy-specific egress proxies
- Config-init has no network access and writes separate read-only service configurations
- Scraper, exporter, and notifier communicate through strict authenticated DTOs

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
- pnpm patched dependencies
- Husky + pretty-quick for pre-commit formatting
- Docker support available for containerized deployment

## Environment Variables

Key environment variables include:

- `DEBUG=moneyman:*` - Enable debug logging
- `MONEYMAN_CONFIG` - JSON configuration (preferred)
- `PUPPETEER_SKIP_DOWNLOAD=true` - Skip Chrome download in development
- Various storage provider specific variables (see README.md)

## Common Development Tasks

1. **Adding a new storage provider**: Implement the storage provider in `apps/exporter/src/storage/`
2. **Modifying configuration**: Update Zod schemas in `packages/protocol/src/config.schema.ts`
3. **Adding new scrapers**: Extend the israeli-bank-scrapers integration
4. **Testing changes**: Run `pnpm test` and validate with `pnpm test:config`
5. **Updating dependencies**: Use `PUPPETEER_SKIP_DOWNLOAD=true` when running `pnpm install` on dev machines (CI uses Docker with system Chromium). When combining multiple dependabot PRs, check for breaking changes requiring code modifications (e.g., Puppeteer major bumps remove or rename APIs). Reference superseded PRs in the combined PR description.
