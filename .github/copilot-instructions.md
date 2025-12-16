# Moneyman - GitHub Copilot Context

## Project Overview

Moneyman is a TypeScript/Node.js application that scrapes financial transaction data from Israeli banks and credit card companies, then exports the data to various storage providers like Google Sheets, YNAB, Azure Data Explorer, and others.

## Key Architecture Components

### Core Structure

- **Language**: TypeScript (compiled to JavaScript)
- **Runtime**: Node.js 20+
- **Package Manager**: npm
- **Build Output**: `dst/` directory
- **Source Code**: `src/` directory

### Main Modules

- `src/index.ts` - Main entry point
- `src/scraper/` - Bank scraping logic using israeli-bank-scrapers
- `src/bot/` - Data processing and messaging logic
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
- **puppeteer**: Web scraping (headless Chrome)
- **zod**: Runtime type validation for configuration
- **telegraf**: Telegram bot integration for notifications
- **google-spreadsheet**: Google Sheets integration
- **ynab**: YNAB (You Need A Budget) integration

## Code Patterns & Standards

### Configuration

- Uses Zod schemas for runtime validation
- Configuration is centralized in `src/config.ts`

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
- `PUPPETEER_SKIP_DOWNLOAD=true` - Skip Chrome download in development
- Various storage provider specific variables (see README.md)

## Common Development Tasks

1. **Adding a new storage provider**: Implement the `StorageBase` interface in `src/bot/storage/`
2. **Modifying configuration**: Update Zod schemas in `src/config.ts`
3. **Adding new scrapers**: Extend the israeli-bank-scrapers integration
4. **Testing changes**: Run `npm test` and validate with `npm run test:config`
