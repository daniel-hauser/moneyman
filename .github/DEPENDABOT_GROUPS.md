# Dependabot Groups Strategy

This document explains the grouping strategy used in `.github/dependabot.yml` to reduce the number of Dependabot PRs while maintaining logical organization.

## Analysis Summary

Based on analysis of 473 Dependabot PRs, the following packages were identified as frequently updated:

1. **israeli-bank-scrapers** - 11 updates (most frequent)
2. **zod** - 7 updates
3. **glob** - 7 updates
4. **@mswjs/interceptors** - 6 updates
5. **@actual-app/api** - 6 updates
6. **google-auth-library** - 5 updates
7. **pg** - 4 updates
8. **hash-it** - 3 updates
9. **dotenv** - 3 updates

## Group Definitions

### 1. `development-dependencies`

**Type-based group**: All development dependencies

Automatically groups all devDependencies together, including:

- TypeScript types (@types/\*)
- Testing tools (jest, ts-jest, jest-mock-extended)
- Build tools (prettier, husky, patch-package)

### 2. `scraper`

**Purpose**: Core bank scraping functionality

Most frequently updated package in the project. Isolated into its own group due to:

- High update frequency (11 updates tracked)
- Critical functionality for the application
- Breaking changes may require careful testing

**Packages**:

- israeli-bank-scrapers

### 3. `storage-apis`

**Purpose**: External service integrations for storing transactions

Groups APIs for various budget/finance platforms:

- @actual-app/api - Actual Budget integration
- ynab - YNAB (You Need A Budget) integration
- buxfer-ts-client - Buxfer personal finance integration

### 4. `kusto`

**Purpose**: Azure Data Explorer (Kusto) integration

**Packages**:

- azure-kusto-data
- azure-kusto-ingest

### 5. `google`

**Purpose**: Google services integration

**Packages**:

- google-spreadsheet - Google Sheets integration
- google-auth-library - Google authentication

### 6. `database`

**Purpose**: PostgreSQL database functionality

Groups all PostgreSQL-related packages:

- pg - PostgreSQL client
- pg-format - SQL formatting
- @types/pg - TypeScript types for pg
- @types/pg-format - TypeScript types for pg-format

### 7. `security`

**Purpose**: Security and network interception

**Packages**:

- @mswjs/interceptors - Network request interception for testing/security
- dotenv - Environment variable management for secrets

### 8. `telegram`

**Purpose**: Telegram bot notifications

**Packages**:

- telegraf - Telegram bot framework
- @telegraf/entity - Telegram entity utilities

### 9. `utilities`

**Purpose**: General utility libraries

**Packages**:

- hash-it - Hashing utility
- date-fns - Date manipulation
- async - Async flow control

### 10. `infra-packages`

**Purpose**: Infrastructure and configuration utilities

**Packages**:

- debug - Debug logging
- zod - Schema validation
- glob - File pattern matching
- jsonc-parser - JSON with comments parser

### 11. `github-actions-updates`

**Purpose**: GitHub Actions workflow dependencies

Groups all GitHub Actions updates together.

## Benefits

This grouping strategy provides:

1. **Reduced PR volume**: Related packages are updated together
2. **Logical organization**: Groups reflect actual usage in the codebase
3. **Easier review**: Related changes can be reviewed together
4. **Clear separation**: Critical packages (like scraper) are isolated for careful review
5. **Type-based efficiency**: All dev dependencies grouped automatically

## Maintenance

When adding new dependencies:

1. Consider their logical role in the application
2. Add to an existing group if appropriate
3. Create a new group for new integration types
4. Update this document to reflect changes
