# moneyman

Automatically add transactions from all major Israeli banks and credit card companies to a online worksheet

Internally we use [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) to scrape the data.

## Why?

Having all your data in one place lets you view all of your expenses in a beautiful dashboard like [Google Data Studio](https://datastudio.google.com), [Azure Data Explorer dashboards](https://docs.microsoft.com/en-us/azure/data-explorer/azure-data-explorer-dashboards), [Microsoft Power BI](https://powerbi.microsoft.com/) and [YNAB](https://www.ynab.com/).

## Important notes

This app requires some technical skills, if you prefer a GUI app you can use [Caspion](https://github.com/brafdlog/caspion) instead.

**Important:**
The current implementation assumes that you run the code on secure and trusted computers.

**It's a bad idea**
to put all your financial data and passwords in one place, especially with more than read-only access.

By using moneyman, you acknowledge that you are taking full responsibility for the code quality and will use it only after you review the code and validate that it's secure.

**Please use a proper secret management solution to save and pass the environment variables**

## How to run

### Cloud (GitHub Actions)

Moneyman can be configured to periodically run automatically, using the [`scrape`](./.github/workflows/scrape.yml) github workflow.

By default, this workflow will run every other day.

Since logs are public for public repos, most logs are off by default and the progress and error messages will be sent in telegram.

#### Setup

1. Fork the [moneyman](https://github.com/daniel-hauser/moneyman) repo to your account
2. Add the following secrets to the [actions secrets](../../settings/secrets/actions) of the forked repo
   1. [`ACCOUNTS_JSON`](#add-accounts-and-scrape) - So moneyman can login to your accounts
   2. [`TELEGRAM_API_[KEY, CHAT_ID]`](#get-notified-in-telegram) - So moneyman can send private logs and errors
   3. The environment variables of the storage you want to use
3. Build and upload the docker image using the "Run workflow" button in [workflows/build.yml](../../actions/workflows/build.yml)
4. Wait for the [scrape workflow](../../actions/workflows/scrape.yml) to be triggered by github

### locally

#### From code

1. Clone this repo
2. Run `npm install`
3. Run `npm run build`
4. Add your env variables (you can add them in a `.env` file in the project's root directory)
5. Run `npm run start`

#### From docker

1. Define the environment variables in a `.env` file
2. `docker run --rm --env-file ".env" ghcr.io/daniel-hauser/moneyman:latest`.

##### Note

docker doesn't support multiline environment variables (i.e. `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`), in that case you can run `docker-compose up` instead

### Debug

We use the [debug](https://www.npmjs.com/package/debug) package for debug messages under the `moneyman:` namespace.

If you want to see them, use the `DEBUG` environment variable with the value `moneyman:*`

## Settings

### Configuration

Moneyman uses JSON configuration for all settings. Set the `MONEYMAN_CONFIG` environment variable with your complete configuration:

#### Accounts (Required)

Configure bank accounts to scrape:

```bash
export MONEYMAN_CONFIG='{
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
  ],
  "storage": { ... },
  "options": { ... }
}'
```

<details>
<summary>Deprecated Environment Variable Settings - Accounts</summary>

#### ACCOUNTS_JSON

A json array of accounts following [this](https://github.com/eshaham/israeli-bank-scrapers#specific-definitions-per-scraper) schema with an additional `companyId` field with a [companyType](https://github.com/eshaham/israeli-bank-scrapers/blob/master/src/definitions.ts#L5:L23) as the value.

Example:

```json
[
  { "companyId": "hapoalim", "userCode": "AB1234", "password": "p@ssword" },
  { "companyId": "visaCal", "username": "Ploni Almoni", "password": "p@ssword" }
]
```

</details>

### Storage (Required - at least one)

#### Google Sheets

Export transactions to a Google Sheets spreadsheet:

```bash
export MONEYMAN_CONFIG='{
  "accounts": [...],
  "storage": {
    "googleSheets": {
      "serviceAccountEmail": "service@account.com",
      "serviceAccountPrivateKey": "-----BEGIN PRIVATE KEY-----...",
      "sheetId": "your-sheet-id",
      "worksheetName": "_moneyman"
    }
  },
  "options": {...}
}'
```

1. Follow the instructions [here](https://theoephraim.github.io/node-google-spreadsheet/#/guides/authentication?id=setting-up-your-quotapplicationquot) to create a google service account.
2. Create a [new sheet](https://sheets.new/) and share it with your service account using the `serviceAccountEmail`.
3. Create a sheet named `_moneyman` with the following headers in the first row:
   | date | amount | description | memo | category | account | hash | comment | scraped at | scraped by | identifier | chargedCurrency | raw |

<details>
<summary>Deprecated Environment Variable Settings - Google Sheets</summary>

| env variable name                    | description                                                   |
| ------------------------------------ | ------------------------------------------------------------- |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | The super secret api key of your service account              |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`       | The service account's email address                           |
| `GOOGLE_SHEET_ID`                    | The id of the spreadsheet you shared with the service account |
| `WORKSHEET_NAME`                     | The name of the sheet you want to add the transactions to     |

</details>

#### YNAB (YouNeedABudget)

Export transactions directly to YNAB:

```bash
export MONEYMAN_CONFIG='{
  "accounts": [...],
  "storage": {
    "ynab": {
      "token": "your-ynab-access-token",
      "budgetId": "your-budget-id",
      "accounts": {
        "5897": "ba2dd3a9-b7d4-46d6-8413-8327203e2b82"
      }
    }
  },
  "options": {...}
}'
```

The `accounts` object maps your bank account IDs to YNAB account IDs.

<details>
<summary>Deprecated Environment Variable Settings - YNAB</summary>

| env variable name | description                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `YNAB_TOKEN`      | The `YNAB` access token. Check [YNAB documentation](https://api.ynab.com/#authentication) about how to obtain it |
| `YNAB_BUDGET_ID`  | The budget id from `YNAB` (can be found in the url when you browse your budget)                                  |

For the accounts mapping, you need to have your bank scraped account number (from your bank) linked to a YNAB account id.

Example accounts mapping:

```json
{
  "5897": "ba2dd3a9-b7d4-46d6-8413-8327203e2b82"
}
```

</details>

#### Azure Data Explorer

Export to Azure Data Explorer cluster:

```bash
export MONEYMAN_CONFIG='{
  "accounts": [...],
  "storage": {
    "azure": {
      "appId": "your-app-id",
      "appKey": "your-app-key",
      "tenantId": "your-tenant-id",
      "databaseName": "your-database",
      "tableName": "your-table",
      "ingestionMapping": "your-mapping",
      "ingestUri": "https://ingest-your-cluster.region.kusto.windows.net"
    }
  },
  "options": {...}
}'
```

1. Create a new data explorer cluster (can be done for free [here](https://docs.microsoft.com/en-us/azure/data-explorer/start-for-free))
2. Create a database within your cluster
3. Create a azure Service Principal following steps 1-7 [here](https://docs.microsoft.com/en-us/azure/data-explorer/provision-azure-ad-app#create-azure-ad-application-registration)
4. Allow the service to ingest data to the database by running this:

```sql
.add database <DB_NAME> ingestors ('aadapp=<APP_ID>;<TENANT_ID>') '<APP_NAME>'
```

5. Create a table with this command:

```sql
.create table <TABLE_NAME> (date: datetime, amount: real, description: string, memo: string, category: string, account: string, hash: string, comment: string, scraped_at: datetime, scraped_by: string, identifier: string, chargedCurrency: string, raw: string)
```

6. Create an ingestion mapping using this command:

```sql
.create table <TABLE_NAME> ingestion json mapping "<INGESTION_MAPPING_NAME>"
'['
'    { "column" : "date", "datatype" : "datetime", "path" : "$.date"},'
'    { "column" : "amount", "datatype" : "real", "path" : "$.amount"},'
'    { "column" : "description", "datatype" : "string", "path" : "$.description"},'
'    { "column" : "memo", "datatype" : "string", "path" : "$.memo"},'
'    { "column" : "category", "datatype" : "string", "path" : "$.category"},'
'    { "column" : "account", "datatype" : "string", "path" : "$.account"},'
'    { "column" : "hash", "datatype" : "string", "path" : "$.hash"},'
'    { "column" : "comment", "datatype" : "string", "path" : "$.comment"},'
'    { "column" : "scraped_at", "datatype" : "datetime", "path" : "$.scrapedAt"},'
'    { "column" : "scraped_by", "datatype" : "string", "path" : "$.scrapedBy"},'
'    { "column" : "identifier", "datatype" : "string", "path" : "$.identifier"},'
'    { "column" : "chargedCurrency", "datatype" : "string", "path" : "$.chargedCurrency"},'
'    { "column" : "raw", "datatype" : "string", "path" : "$.raw"}'
']'
```

<details>
<summary>Deprecated Environment Variable Settings - Azure Data Explorer</summary>

| env variable name         | description                               |
| ------------------------- | ----------------------------------------- |
| `AZURE_APP_ID`            | the app id you created                    |
| `AZURE_APP_KEY`           | the app key you created                   |
| `AZURE_TENANT_ID`         | the tenant id of your app                 |
| `AZURE_DATABASE_NAME`     | the database name inside your cluster     |
| `AZURE_TABLE_NAME`        | the table name inside your database       |
| `AZURE_INGESTION_MAPPING` | the ingestion mapping (created in step 4) |
| `AZURE_INGEST_URI`        | the ingest endpoint of your cluster       |

</details>

#### Buxfer

Export transactions to Buxfer:

```bash
export MONEYMAN_CONFIG='{
  "accounts": [...],
  "storage": {
    "buxfer": {
      "userName": "your-buxfer-username",
      "password": "your-buxfer-password",
      "accounts": {
        "5897": "123456"
      }
    }
  },
  "options": {...}
}'
```

<details>
<summary>Deprecated Environment Variable Settings - Buxfer</summary>

| env variable name  | description                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `BUXFER_USER_NAME` | The `Buxfer` user name. Check [Buxfer settings](https://www.buxfer.com/settings?type=login) about how to obtain it |
| `BUXFER_PASSWORD`  | The `Buxfer` password                                                                                              |

For the accounts mapping, you need to have your bank scraped account number (from your bank) linked to a Buxfer account id.

Example accounts mapping:

```json
{
  "5897": "123456"
}
```

</details>

#### Actual Budget

Export transactions to Actual Budget server:

```bash
export MONEYMAN_CONFIG='{
  "accounts": [...],
  "storage": {
    "actual": {
      "serverUrl": "https://your-actual-server.com",
      "password": "your-password",
      "budgetId": "your-budget-id",
      "accounts": {
        "5897": "actual-account-id"
      }
    }
  },
  "options": {...}
}'
```

<details>
<summary>Deprecated Environment Variable Settings - Actual Budget</summary>

| env variable name   | description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `ACTUAL_SERVER_URL` | The URL of your Actual Budget server                              |
| `ACTUAL_PASSWORD`   | The password for your Actual Budget server                        |
| `ACTUAL_BUDGET_ID`  | The budget ID in Actual Budget                                    |
| `ACTUAL_ACCOUNTS`   | JSON mapping of bank account numbers to Actual Budget account IDs |

</details>

#### Local JSON Storage

Save transactions to local JSON files:

```bash
export MONEYMAN_CONFIG='{
  "accounts": [...],
  "storage": {
    "localJson": {
      "enabled": true
    }
  },
  "options": {...}
}'
```

<details>
<summary>Deprecated Environment Variable Settings - Local JSON</summary>

| env variable name    | description                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `LOCAL_JSON_STORAGE` | If truthy, all transaction will be saved to a `<process cwd>/output/<ISO timestamp>.json` file |

</details>

#### Web POST

Export transactions as a POST request to a web address:

```bash
export MONEYMAN_CONFIG='{
  "accounts": [...],
  "storage": {
    "webPost": {
      "url": "https://your-endpoint.com/transactions",
      "authorizationToken": "Bearer your-token"
    }
  },
  "options": {...}
}'
```

The transactions will be sent as a JSON array in the body of the request.

<details>
<summary>Deprecated Environment Variable Settings - Web POST</summary>

| env variable name              | description                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `WEB_POST_URL`                 | The url to post the transactions to                                          |
| `WEB_POST_AUTHORIZATION_TOKEN` | The Authorization header value (i.e. `Bearer *****`, but can use any schema) |

> [!IMPORTANT]
> Be sure to post only to a trusted server.

</details>

### Options

#### Scraping Options

Configure scraper behavior:

```bash
export MONEYMAN_CONFIG='{
  "accounts": [...],
  "storage": {...},
  "options": {
    "scraping": {
      "accountsToScrape": ["hapoalim", "visaCal"],
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
}'
```

<details>
<summary>Deprecated Environment Variable Settings - Scraping</summary>

| env variable name                     | default            | description                                                                                                                                                               |
| ------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNTS_TO_SCRAPE`                  | `""`               | A comma separated list of providers to take from `ACCOUNTS_JSON`. if empty, all accounts will be used                                                                     |
| `DAYS_BACK`                           | `10`               | The amount of days back to scrape                                                                                                                                         |
| `TZ`                                  | `'Asia/Jerusalem'` | A timezone for the process - used for the formatting of the timestamp                                                                                                     |
| `FUTURE_MONTHS`                       | `1`                | The amount of months that will be scrapped in the future, starting from the day calculated using `DAYS_BACK`                                                              |
| `TRANSACTION_HASH_TYPE`               | ``                 | The hash type to use for the transaction hash. Can be `moneyman` or empty. The default will be changed to `moneyman` in the upcoming versions                             |
| `ADDITIONAL_TRANSACTION_INFO_ENABLED` | `'false'`          | If set to `'true'`, enables the `additionalTransactionInformation` option in the underlying scraper, which may provide more detailed transaction data for some providers. |
| `HIDDEN_DEPRECATIONS`                 | `''`               | A comma separated list of deprecations to hide                                                                                                                            |
| `PUPPETEER_EXECUTABLE_PATH`           | `undefined`        | An ExecutablePath for the scraper. if undefined defaults to system.                                                                                                       |
| `MAX_PARALLEL_SCRAPERS`               | `1`                | The maximum number of parallel scrapers to run                                                                                                                            |
| `DOMAIN_TRACKING_ENABLED`             | `''`               | Enable tracking of all domains accessed during scraping                                                                                                                   |

</details>

#### Security Options

Configure domain security and firewall settings:

```bash
export MONEYMAN_CONFIG='{
  "accounts": [...],
  "storage": {...},
  "options": {
    "security": {
      "firewallSettings": "companyId ALLOW domain.com",
      "blockByDefault": false
    }
  }
}'
```

Given the nature of the scraping process, it's important to keep track of the domains accessed during the scraping process and ensure we connect only to the domains we expect.

<details>
<summary>Deprecated Environment Variable Settings - Security</summary>

Given the nature of the scraping process, it's important to keep track of the domains accessed during the scraping process and ensure we connect only to the domains we expect.

#### Domain Tracking

Use `DOMAIN_TRACKING_ENABLED` environment variable to generate a report of all domains accessed during the scraping process. This will help you to understand which domains are being accessed by the scrapers.

#### Domain Whitelisting

The Domain whitelisting is a **security** feature that will allow you to specify which domains are allowed to be accessed by the scrapers.

To enable the Domain whitelisting, use the env var `FIREWALL_SETTINGS`.

Each row is in the following format: `<companyId> <ALLOW|BLOCK> <domain>`

example: `hapoalim ALLOW www.bankhapoalim.co.il`

Example settings:

```
hapoalim ALLOW www.bankhapoalim.co.il
hapoalim ALLOW login.bankhapoalim.co.il
hapoalim ALLOW loginp.bankhapoalim.co.il
```

**Rules:**

- `ALLOW` - Allow the connection
- `BLOCK` - Block the connection
- If no rule exists for a domain, the default behavior is to allow the connection

> [!IMPORTANT]
> All rules apply only if there is at least one rule for the scraper. scrapers with no rules will allow all connections

Rules support parent domain matching, so a rule for `example.com` will apply to `api.example.com` and `www.example.com` as well.

</details>

#### Notification Options

Configure Telegram notifications:

```bash
export MONEYMAN_CONFIG='{
  "accounts": [...],
  "storage": {...},
  "options": {
    "notifications": {
      "telegram": {
        "apiKey": "123456:ABC...",
        "chatId": "12345"
      }
    }
  }
}'
```

We use telegram to send you the update status.

1. Create your bot following [this](https://core.telegram.org/bots#creating-a-new-bot)
2. Open this url `https://api.telegram.org/bot<TELEGRAM_API_KEY>/getUpdates`
3. Send a message to your bot and find the chat id

<details>
<summary>Deprecated Environment Variable Settings - Notifications</summary>

| env variable name  | description                                              |
| ------------------ | -------------------------------------------------------- |
| `TELEGRAM_API_KEY` | The telegram bot token you got from @BotFather           |
| `TELEGRAM_CHAT_ID` | The chat id of the chat you want to send the messages to |

</details>

#### Logging Options

Configure debug and logging settings:

```bash
export MONEYMAN_CONFIG='{
  "accounts": [...],
  "storage": {...},
  "options": {
    "logging": {
      "debug": "moneyman:*",
      "separatedMode": true,
      "timezone": "Asia/Jerusalem",
      "getIpInfoUrl": "https://ipinfo.io/json"
    }
  }
}'
```

We use the [debug](https://www.npmjs.com/package/debug) package for debug messages under the `moneyman:` namespace.

If you want to see them, use the `debug` setting with the value `moneyman:*`

### Migration Helper

To migrate from environment variables to JSON config:

1. Set `SEND_NEW_CONFIG_TO_TG=true` environment variable
2. Run moneyman with your existing environment variables
3. A `config.txt` file will be sent to your Telegram chat containing the equivalent JSON configuration
4. Use this JSON as your `MONEYMAN_CONFIG` value

### Backward Compatibility

If `MONEYMAN_CONFIG` is not set, moneyman will continue to use individual environment variables as before. No breaking changes to existing setups.
