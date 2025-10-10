# Configuration Migration Guide

Moneyman now supports unified JSON configuration through the `MONEYMAN_CONFIG` environment variable, while maintaining full backward compatibility with individual environment variables.

## New Configuration Method

Instead of setting multiple environment variables, you can now provide a single JSON configuration:

```bash
export MONEYMAN_CONFIG='{
  "accounts": [
    {
      "companyId": "bank1",
      "username": "user",
      "password": "pass"
    }
  ],
  "storage": {
    "googleSheets": {
      "serviceAccountEmail": "service@account.com",
      "serviceAccountPrivateKey": "-----BEGIN PRIVATE KEY-----...",
      "sheetId": "your-sheet-id",
      "worksheetName": "_moneyman"
    },
    "ynab": {
      "token": "your-ynab-token",
      "budgetId": "your-budget-id",
      "accounts": {
        "account1": "ynab-account-id"
      }
    }
  },
  "options": {
    "scraping": {
      "accountsToScrape": ["bank1", "bank2"],
      "daysBack": 10
    },
    "notifications": {
      "telegram": {
        "apiKey": "your-telegram-bot-token",
        "chatId": "your-chat-id"
      }
    }
  }
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

## Supported Configuration Structure

The new JSON configuration uses a nested structure organized into logical sections:

### `accounts` (Required)

Array of bank account configurations:

```json
"accounts": [
  {
    "companyId": "hapoalim",
    "userCode": "AB1234",
    "password": "p@ssword"
  },
  {
    "companyId": "visaCal",
    "username": "Ploni Almoni",
    "password": "p@ssword"
  }
]
```

### `storage` (Required - at least one)

Configuration for various storage providers:

#### Google Sheets

```json
"storage": {
  "googleSheets": {
    "serviceAccountEmail": "service@account.com",
    "serviceAccountPrivateKey": "-----BEGIN PRIVATE KEY-----...",
    "sheetId": "your-sheet-id",
    "worksheetName": "_moneyman"
  }
}
```

#### YNAB (You Need A Budget)

```json
"storage": {
  "ynab": {
    "token": "your-ynab-token",
    "budgetId": "your-budget-id",
    "accounts": {
      "bankAccountId": "ynab-account-id"
    }
  }
}
```

#### Azure Data Explorer

```json
"storage": {
  "azure": {
    "appId": "your-app-id",
    "appKey": "your-app-key",
    "tenantId": "your-tenant-id",
    "databaseName": "your-database",
    "tableName": "your-table",
    "ingestionMapping": "your-mapping",
    "ingestUri": "https://your-cluster.kusto.windows.net"
  }
}
```

#### Buxfer

```json
"storage": {
  "buxfer": {
    "userName": "your-username",
    "password": "your-password",
    "accounts": {
      "bankAccountId": "buxfer-account-id"
    }
  }
}
```

#### Actual Budget

```json
"storage": {
  "actual": {
    "serverUrl": "https://your-actual-server.com",
    "password": "your-password",
    "budgetId": "your-budget-id",
    "accounts": {
      "bankAccountId": "actual-account-id"
    }
  }
}
```

#### Web Post

```json
"storage": {
  "webPost": {
    "url": "https://your-endpoint.com/transactions",
    "authorizationToken": "your-auth-token"
  }
}
```

#### PostgreSQL (SQL)

```json
"storage": {
  "sql": {
    "connectionString": "postgresql://user:password@host:5432/database",
    "schema": "moneyman"
  }
}
```

- `schema` is optional and defaults to `"moneyman"`. moneyman will create the schema (and required tables) on first run if they do not exist.

#### Local JSON

```json
"storage": {
  "localJson": {
    "enabled": true
  }
}
```

### `options` (Optional)

Additional configuration options organized by category:

#### Scraping Options

```json
"options": {
  "scraping": {
    "accountsToScrape": ["bank1", "bank2"],
    "daysBack": 10,
    "futureMonths": 1,
    "timezone": "Asia/Jerusalem",
    "transactionHashType": "moneyman",
    "additionalTransactionInfo": false,
    "hiddenDeprecations": [],
    "puppeteerExecutablePath": "/usr/bin/chromium",
    "maxParallelScrapers": 1,
    "domainTracking": false
  }
}
```

#### Security Options

```json
"options": {
  "security": {
    "firewallSettings": "companyId ALLOW domain.com",
    "blockByDefault": false
  }
}
```

#### Notification Options

```json
"options": {
  "notifications": {
    "telegram": {
      "apiKey": "123456:ABC...",
      "chatId": "12345"
    }
  }
}
```

#### Logging Options

```json
"options": {
  "logging": {
    "getIpInfoUrl": "https://ipinfo.io/json"
  }
}
```

**Note:** Debug and timezone settings are now handled via environment variables:

- Use `DEBUG=moneyman:*` environment variable for debug logging
- Use `TZ=Asia/Jerusalem` environment variable for timezone configuration

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
  "accounts": [{"companyId": "hapoalim", "userCode": "AB1234", "password": "p@ssword"}],
  "storage": {
    "googleSheets": {
      "serviceAccountPrivateKey": "...",
      "serviceAccountEmail": "service@account.com",
      "sheetId": "1A2B3C...",
      "worksheetName": "_moneyman"
    }
  },
  "options": {
    "scraping": {
      "daysBack": 15
    },
    "notifications": {
      "telegram": {
        "apiKey": "123456:ABC...",
        "chatId": "12345"
      }
    }
  }
}'
```

Both methods work and can be used interchangeably!
