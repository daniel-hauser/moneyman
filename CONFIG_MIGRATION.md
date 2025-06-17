# Configuration Migration Guide

Moneyman now supports unified JSON configuration through the `MONEYMAN_CONFIG` environment variable, while maintaining full backward compatibility with individual environment variables.

## New Configuration Method

Instead of setting multiple environment variables, you can now provide a single JSON configuration:

```bash
export MONEYMAN_CONFIG='{
  "DAYS_BACK": "10",
  "ACCOUNTS_TO_SCRAPE": "bank1,bank2",
  "ACCOUNTS_JSON": "[{\"companyId\":\"bank1\",\"username\":\"user\",\"password\":\"pass\"}]",
  "TELEGRAM_API_KEY": "your-telegram-bot-token",
  "TELEGRAM_CHAT_ID": "your-chat-id",
  "GOOGLE_SHEET_ID": "your-sheet-id",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL": "service@account.com",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----...",
  "YNAB_TOKEN": "your-ynab-token",
  "YNAB_BUDGET_ID": "your-budget-id",
  "YNAB_ACCOUNTS": "{\"account1\":\"ynab-account-id\"}"
}'
```

## Migration Assistance

To help migrate from environment variables to the new JSON config:

1. Set `SEND_NEW_CONFIG_TO_TG=true` environment variable
2. Run moneyman with your existing environment variables
3. A `config.txt` file will be sent to your Telegram chat containing the equivalent JSON configuration
4. Use this JSON as your `MONEYMAN_CONFIG` value

## Backward Compatibility

If `MONEYMAN_CONFIG` is not set, moneyman will continue to use individual environment variables as before. No breaking changes to existing setups.

## Configuration Validation

The new system uses Zod for runtime validation of the configuration, ensuring:

- Type safety
- Default values for missing configurations
- Graceful fallback to environment variables if JSON parsing fails

## Supported Configuration Keys

All existing environment variables are supported in the JSON format:

### Core Scraper Configuration

- `DAYS_BACK` - Number of days back to scrape (default: "10")
- `ACCOUNTS_TO_SCRAPE` - Comma-separated list of account IDs
- `FUTURE_MONTHS` - Number of future months to scrape
- `MAX_PARALLEL_SCRAPERS` - Maximum parallel scraper instances
- `ADDITIONAL_TRANSACTION_INFO_ENABLED` - Enable additional transaction info
- `ACCOUNTS_JSON` - JSON array of account configurations

### Notification Configuration

- `TELEGRAM_API_KEY` - Telegram bot API key
- `TELEGRAM_CHAT_ID` - Telegram chat ID for notifications

### Storage Configuration

#### Google Sheets

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GOOGLE_SHEET_ID`
- `WORKSHEET_NAME`

#### Azure Data Explorer

- `AZURE_APP_ID`
- `AZURE_APP_KEY`
- `AZURE_TENANT_ID`
- `ADE_DATABASE_NAME`
- `ADE_TABLE_NAME`
- `ADE_INGESTION_MAPPING`
- `ADE_INGEST_URI`

#### YNAB (You Need A Budget)

- `YNAB_TOKEN`
- `YNAB_BUDGET_ID`
- `YNAB_ACCOUNTS`

#### Buxfer

- `BUXFER_USER_NAME`
- `BUXFER_PASSWORD`
- `BUXFER_ACCOUNTS`

#### Actual Budget

- `ACTUAL_SERVER_URL`
- `ACTUAL_PASSWORD`
- `ACTUAL_BUDGET_ID`
- `ACTUAL_ACCOUNTS`

#### Other Storage Options

- `WEB_POST_URL`
- `WEB_POST_AUTHORIZATION_TOKEN`
- `LOCAL_JSON_STORAGE`

### Additional Configuration

- `TRANSACTION_HASH_TYPE`
- `HIDDEN_DEPRECATIONS`
- `PUPPETEER_EXECUTABLE_PATH`
- `GET_IP_INFO_URL`

### Security Configuration

Note: Security-related configurations still use environment variables directly for runtime testability:

- `DOMAIN_TRACKING_ENABLED`
- `FIREWALL_SETTINGS`
- `BLOCK_BY_DEFAULT`

## Example Migration

### Before (Environment Variables)

```bash
export DAYS_BACK=15
export TELEGRAM_API_KEY=123456:ABC...
export TELEGRAM_CHAT_ID=12345
export GOOGLE_SHEET_ID=1A2B3C...
```

### After (JSON Config)

```bash
export MONEYMAN_CONFIG='{
  "DAYS_BACK": "15",
  "TELEGRAM_API_KEY": "123456:ABC...",
  "TELEGRAM_CHAT_ID": "12345",
  "GOOGLE_SHEET_ID": "1A2B3C..."
}'
```

Both methods work and can be used interchangeably!
