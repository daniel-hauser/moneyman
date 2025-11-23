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

By default, this workflow will run twice daily at 10:05 and 22:05 UTC (12:05 and 00:05 or 13:05 and 01:05 in Israel time, depending on DST).

Since logs are public for public repos, most logs are off by default and the progress and error messages will be sent in telegram.

#### Setup

1. Fork the [moneyman](https://github.com/daniel-hauser/moneyman) repo to your account
2. Add the `MONEYMAN_CONFIG` to the [actions secrets](../../settings/secrets/actions) of the forked repo
   - Use the config in `.env.public` as a starting point and add configurations for your selected storage
   - For better logging, add the [telegram configuration](#get-notified-in-telegram) So moneyman can send private logs and errors
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

##### Using a configuration file (recommended for Docker)

Instead of passing the configuration as an environment variable, you can mount a configuration file:

```bash
docker run --rm \
  -v /path/to/config:/config \
  -e MONEYMAN_CONFIG_PATH=/config/config.json \
  ghcr.io/daniel-hauser/moneyman:latest
```

Or use Docker secrets:

```bash
docker run --rm \
  --secret config.json \
  -e MONEYMAN_CONFIG_PATH=/run/secrets/config.json \
  ghcr.io/daniel-hauser/moneyman:latest
```

##### Note

docker doesn't support multiline environment variables (i.e. `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`), in that case you can run `docker-compose up` instead

### Debug

We use the [debug](https://www.npmjs.com/package/debug) package for debug messages under the `moneyman:` namespace.

If you want to see them, use the `DEBUG` environment variable with the value `moneyman:*`

## Settings

### Add accounts and scrape

Moneyman uses a JSON configuration for all settings. You can provide configuration in two ways:

1. **`MONEYMAN_CONFIG` environment variable**: The JSON configuration as a string
2. **`MONEYMAN_CONFIG_PATH` environment variable**: Path to a JSON or JSONC configuration file

The configuration file approach is recommended for Docker/Kubernetes environments and supports JSON with Comments (JSONC) for better readability.

> **Tip:** See [`config.example.jsonc`](./config.example.jsonc) for a complete example configuration file with comments.

#### Accounts Configuration

A json array of accounts following [this](https://github.com/eshaham/israeli-bank-scrapers#specific-definitions-per-scraper) schema with an additional `companyId` field with a [companyType](https://github.com/eshaham/israeli-bank-scrapers/blob/master/src/definitions.ts#L5:L23) as the value.

```typescript
/**
 * Previously configured via ACCOUNTS_JSON environment variable
 */
accounts: Array<{
  companyId: string;
  password: string;
  /**
   * And any other fields required by the specific scraper
   */
}>;
```

#### Other configurations

| env variable name       | default            | description                                                                                           |
| ----------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `TZ`                    | `'Asia/Jerusalem'` | A timezone for the process - used for the formatting of the timestamp                                 |
| `MONEYMAN_CONFIG`       |                    | The JSON configuration for the process                                                                |
| `MONEYMAN_CONFIG_PATH`  |                    | Path to a JSON/JSONC configuration file (used if `MONEYMAN_CONFIG` is not set)                        |
| `SEND_NEW_CONFIG_TO_TG` | `"false"`          | Set to `"true"` to send the current configuration as `config.txt` via Telegram for debugging purposes |

```typescript
options: {
  scraping: {
    /**
     * A comma separated list of providers to take from `accounts`. if empty, all accounts will be used
     * @default all accounts
     * @replaces ACCOUNTS_TO_SCRAPE environment variable
     */
    accountsToScrape?: string[];
    /**
     * The amount of days back to scrape
     * @default 10
     * @replaces DAYS_BACK environment variable
     */
    daysBack?: number;
    /**
     * The amount of months that will be scrapped in the future, starting from the day calculated using `daysBack`
     * @default 1
     * @replaces FUTURE_MONTHS environment variable
     */
    futureMonths?: number;
    /**
     * The hash type to use for the transaction hash. Can be `moneyman` or empty. The default will be changed to `moneyman` in the upcoming versions
     * @default ""
     * @replaces TRANSACTION_HASH_TYPE environment variable
     */
    transactionHashType?: "" | "moneyman";
    /**
     * If set to `'true'`, enables the `additionalTransactionInformation` option in the underlying scraper, which may provide more detailed transaction data for some providers.
     * @default false
     * @replaces ADDITIONAL_TRANSACTION_INFO_ENABLED environment variable
     */
    additionalTransactionInfo?: boolean;
    /**
     * A comma separated list of deprecations to hide
     * @default []
     * @replaces HIDDEN_DEPRECATIONS environment variable
     */
    hiddenDeprecations?: string[];
    /**
     * An ExecutablePath for the scraper. if undefined defaults to system.
     * @replaces PUPPETEER_EXECUTABLE_PATH environment variable
     */
    puppeteerExecutablePath?: string;
    /**
     * The maximum number of parallel scrapers to run
     * @default 1
     * @replaces MAX_PARALLEL_SCRAPERS environment variable
     */
    maxParallelScrapers?: number;
    /**
     * Enable tracking of all domains accessed during scraping
     * @default false
     * @replaces DOMAIN_TRACKING_ENABLED environment variable
     */
    domainTracking?: boolean;
  },
  logging: {
    /**
     * The URL to get IP information from
     * @default "https://ipinfo.io/json"
     * @replaces GET_IP_INFO_URL environment variable
     */
    getIpInfoUrl?: string;
  };
};
```

### Domain Security

Given the nature of the scraping process, it's important to keep track of the domains accessed during the scraping process and ensure we connect only to the domains we expect.

#### Domain Tracking

After enabling the domain tracking setting, the process will keep track of all domains accessed during the scraping process.
When the scraping process is done, a message will be sent to the telegram chat with the list of domains accessed.

#### Domain Whitelisting

You can control which domains each scraper can access by configuring firewall rules. Each rule follows the format:

```
<companyId> <ALLOW|BLOCK> <domain>
```

Use the following configuration to setup:

```typescript
options: {
  security: {
    /**
     * A list of domain rules. Each line should follow the format `<companyId> <ALLOW|BLOCK> <domain>`
     * @replaces FIREWALL_SETTINGS environment variable (newline-separated rules, or pipe-separated for single-line env vars)
     */
    firewallSettings?: string[];
    /**
     * If truthy, all domains with no rule will be blocked by default. If falsy, all domains will be allowed by default
     * @replaces BLOCK_BY_DEFAULT environment variable
     */
    blockByDefault?: boolean;
  };
};
```

Example:

```typescript
options: {
  security: {
    firewallSettings: [
      "hapoalim ALLOW bankhapoalim.co.il",
      "visaCal BLOCK suspicious-domain.com",
    ];
  }
}
```

When a rule exists for a specific domain, the scraper will:

- `ALLOW` - Allow the connection to proceed
- `BLOCK` - Block the connection
- If no rule exists for a domain, the default behavior is to allow the connection

> [!IMPORTANT]
> All rules apply only if there is at least one rule for the scraper. scrapers with no rules will allow all connections

Rules support parent domain matching, so a rule for `example.com` will apply to `api.example.com` and `www.example.com` as well.

### Get notified in telegram

We use telegram to send you the update status.

Setup instructions:

1. Create your bot following [this](https://core.telegram.org/bots#creating-a-new-bot)
2. Open this url `https://api.telegram.org/bot<TELEGRAM_API_KEY>/getUpdates`
3. Send a message to your bot and find the chat id

```typescript
options: {
  notifications: {
    telegram?: {
      /**
       * The super secret api key you got from BotFather
       * @replaces TELEGRAM_API_KEY environment variable
       */
      apiKey: string;
      /**
       * The chat id
       * @replaces TELEGRAM_CHAT_ID environment variable
       */
      chatId: string;
      /**
       * Enable OTP (One-Time Password) support for 2FA authentication.
       * When enabled, the bot will ask for OTP codes via Telegram during scraping.
       * @default false
       */
      enableOtp?: boolean;
      /**
       * Maximum time in seconds to wait for OTP response from user.
       * @default 300 (5 minutes)
       */
      otpTimeoutSeconds?: number;
    };
  };
};
```

#### Using OTP 2FA with OneZero Accounts

If you have OneZero accounts that require 2FA authentication, you can enable OTP support:

1. **Enable OTP in your configuration**:

   ```json
   {
     "options": {
       "notifications": {
         "telegram": {
           "apiKey": "your-telegram-bot-token",
           "chatId": "your-chat-id",
           "enableOtp": true,
           "otpTimeoutSeconds": 300
         }
       }
     }
   }
   ```

2. **Configure your OneZero account with phone number**:

   ```json
   {
     "accounts": [
       {
         "companyId": "oneZero",
         "email": "your-email@example.com",
         "password": "your-password",
         "phoneNumber": "+972501234567"
       }
     ]
   }
   ```

3. **During scraping**: When a OneZero account requires 2FA, the bot will:
   - Send a message asking for the OTP code
   - Wait for you to reply with the code (4-8 digits)
   - Continue the scraping process automatically

### Export to Azure Data Explorer

Setup instructions:

1. Create a new data explorer cluster (can be done for free [here](https://docs.microsoft.com/en-us/azure/data-explorer/start-for-free))
2. Create a database within your cluster
3. Create a azure Service Principal following steps 1-7 [here](https://docs.microsoft.com/en-us/azure/data-explorer/provision-azure-ad-app#create-azure-ad-application-registration)
4. Allow the service to ingest data to the database by running this:

   ```kql
   .execute database script <|
   .add database ['<ADE_DATABASE_NAME>'] ingestors ('aadapp=<AZURE_APP_ID>;<AZURE_TENANT_ID>')
   ```

5. Create a table and ingestion mapping by running this: (Replace `<ADE_TABLE_NAME>` and `<ADE_INGESTION_MAPPING>`)

   ````kql
   .execute database script <|
   .drop table <ADE_TABLE_NAME> ifexists
   .create table <ADE_TABLE_NAME> (
      metadata: dynamic,
      transaction: dynamic
   )
   .create table <ADE_TABLE_NAME> ingestion json mapping '<ADE_INGESTION_MAPPING>' ```
   [
      { "column": "transaction", "path": "$.transaction" },
      { "column": "metadata", "path": "$.metadata" }
   ]
   ```
   ````

   Feel free to add more columns to the table and ingestion json mapping

Use the following configuration to setup:

```typescript
storage: {
  azure?: {
    /**
     * The azure application ID
     * @replaces AZURE_APP_ID environment variable
     */
    appId: string;
    /**
     * The azure application secret key
     * @replaces AZURE_APP_KEY environment variable
     */
    appKey: string;
    /**
     * The tenant ID of your azure application
     * @replaces AZURE_TENANT_ID environment variable
     */
    tenantId: string;
    /**
     * The name of the database
     * @replaces ADE_DATABASE_NAME environment variable
     */
    databaseName: string;
    /**
     * The name of the table
     * @replaces ADE_TABLE_NAME environment variable
     */
    tableName: string;
    /**
     * The name of the JSON ingestion mapping
     * @replaces ADE_INGESTION_MAPPING environment variable
     */
    ingestionMapping: string;
    /**
     * The ingest URI of the cluster
     * @replaces ADE_INGEST_URI environment variable
     */
    ingestUri: string;
  };
};
```

### Export JSON files

Export transactions to json file.

Use the following configuration to setup:

```typescript
storage: {
  localJson?: {
    /**
     * If truthy, all transaction will be saved to a `<process cwd>/output/<ISO timestamp>.json` file
     * @replaces LOCAL_JSON_STORAGE environment variable
     */
    enabled: boolean;
    /**
     * Optional: a filesystem path where JSON files will be saved.
     * If not provided, files are written to `<process.cwd()>/output`.
     * Files are named using an ISO timestamp (colons are replaced with `_`),
     * for example: `2025-11-23T12_34_56.789Z.json`.
     */
    path?: string;
  };
};
```

### Export to web address

Export transactions as a POST request to a web address.

The transactions will be sent as a JSON array in the body of the request with the following structure:

```
{
    /**
     * Date in "dd/mm/yyyy" format
     */
    date: string,
    amount: number,
    description: string,
    memo: string,
    category: string,
    account: string,
    hash: string,
    comment: string | undefined,
    /**
     * Scraped date in "YYYY-MM-DD" format
     */
    "scraped at": string,
    "scraped by": string,
    identifier: string,
    chargedCurrency: string | undefined,
}
```

Use the following configuration to setup:

```typescript
storage: {
  webPost?: {
    /**
     * The URL to post to
     * @replaces WEB_POST_URL environment variable
     */
    url: string;
    /**
     * The Authorization header value (i.e. `Bearer *****`, but can use any schema)
     * @replaces WEB_POST_AUTHORIZATION_TOKEN environment variable
     */
    authorizationToken: string;
  };
};
```

> [!IMPORTANT]
> Be sure to post only to a trusted server.

### Export to PostgreSQL

Persist transactions in a PostgreSQL database for analytics or downstream integrations.

- moneyman creates (or reuses) a dedicated schema named `moneyman` by default. You can override the schema name with the `schema` property if you prefer a different dedicated schema.
- Within that schema two tables are maintained:
  - `transactions` – one row per completed transaction, upserted by `unique_id`.
  - `transactions_raw` – an append-only log that stores every scrape (including pending transactions) together with the original JSON payload.

Use the following configuration to setup:

```typescript
storage: {
  sql?: {
    /**
     * PostgreSQL connection string (for example: "postgresql://user:pass@host:5432/moneyman")
     */
    connectionString: string;
    /**
     * Optional dedicated schema for moneyman data. Defaults to "moneyman".
     */
    schema?: string;
  };
};
```

> [!TIP]
> Grant the configured user rights to create the schema (first run) and manage the two tables.

### Export to excel on OneDrive

WIP

### Export to google sheets

Export transactions to a Google Sheets spreadsheet.

Setup instructions:

1. Follow the instructions [here](https://theoephraim.github.io/node-google-spreadsheet/#/guides/authentication?id=setting-up-your-quotapplicationquot) to create a google service account.
2. Create a [new sheet](https://sheets.new/) and share it with your service account using the `serviceAccountEmail`.
3. Create a sheet named `_moneyman` with the following headers in the first row:
   | date | amount | description | memo | category | account | hash | comment | scraped at | scraped by | identifier | chargedCurrency | raw |

Use the following configuration to setup:

```typescript
storage: {
  googleSheets?: {
    /**
     * The super secret api key of your service account
     * @replaces GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY environment variable
     */
    serviceAccountPrivateKey: string;
    /**
     * The service account's email address
     * @replaces GOOGLE_SERVICE_ACCOUNT_EMAIL environment variable
     */
    serviceAccountEmail: string;
    /**
     * The id of the spreadsheet you shared with the service account
     * @replaces GOOGLE_SHEET_ID environment variable
     */
    sheetId: string;
    /**
     * The name of the sheet you want to add the transactions to
     * @default "_moneyman" (when using environment variables)
     * @replaces WORKSHEET_NAME environment variable
     */
    worksheetName: string;
  };
};
```

### Export to YNAB (YouNeedABudget)

To export your transactions directly to `YNAB` you need to use the following configuration to setup:

```typescript
storage: {
  ynab?: {
    /**
     * The `YNAB` access token. Check [YNAB documentation](https://api.ynab.com/#authentication) about how to obtain it
     * @replaces YNAB_TOKEN environment variable
     */
    token: string;
    /**
     * The `YNAB` budget ID where you want to import the data. You can obtain it opening [YNAB application](https://app.ynab.com/) on a browser and taking the budget `UUID` in the `URL`
     * @replaces YNAB_BUDGET_ID environment variable
     */
    budgetId: string;
    /**
     * A key-value list to correlate each account with the `YNAB` account `UUID`
     * @replaces YNAB_ACCOUNTS environment variable
     */
    accounts: Record<string, string>;
  };
};
```

#### accounts

A `JSON` key-value pair structure representing a mapping between two identifiers. The `key` represent the account ID as is understood by moneyman and the `value` it's the `UUID` visible in the YNAB URL when an account is selected.

For example, in the URL:
`https://app.ynab.com/22aa9fcd-93a9-47e9-8ff6-33036b7c6242/accounts/ba2dd3a9-b7d4-46d6-8413-8327203e2b82` the account UUID is the second `UUID`.

Example:

```json
{
  "5897": "ba2dd3a9-b7d4-46d6-8413-8327203e2b82"
}
```

### Export to [Buxfer](https://www.buxfer.com/features)

To export your transactions directly to `Buxfer` you need to use the following configuration to setup:

```typescript
storage: {
  buxfer?: {
    /**
     * The `Buxfer` user name. Check [Buxfer settings](https://www.buxfer.com/settings?type=login) about how to obtain it
     * @replaces BUXFER_USER_NAME environment variable
     */
    userName: string;
    /**
     * The `Buxfer` user password. Check [Buxfer settings](https://www.buxfer.com/settings?type=login) about how to obtain it
     * @replaces BUXFER_PASSWORD environment variable
     */
    password: string;
    /**
     * A key-value list to correlate each account with the `Buxfer` account `UUID`
     * @replaces BUXFER_ACCOUNTS environment variable
     */
    accounts: Record<string, string>;
  };
};
```

#### accounts

A `JSON` key-value pair structure representing a mapping between two identifiers. The `key` represent the account ID as is understood by moneyman (as obtained from web scrapping the financial institutions) and the `value` it's the `UUID` visible in the Buxfer URL when an account is selected.

For example, in the URL:
`https://www.buxfer.com/account?id=123456` the account UUID is the account id query parameter.

Example:

```json
{
  "5897": "123456"
}
```

### Export to [Actual Budget](https://actualbudget.org/)

Export transactions directly to your Actual Budget server.

Use the following configuration to setup:

```typescript
storage: {
  actual?: {
    /**
     * The URL of your Actual Budget server
     * @replaces ACTUAL_SERVER_URL environment variable
     */
    serverUrl: string;
    /**
     * The password for your Actual Budget server
     * @replaces ACTUAL_PASSWORD environment variable
     */
    password: string;
    /**
     * The ID of the budget where you want to import the data
     * @replaces ACTUAL_BUDGET_ID environment variable
     */
    budgetId: string;
    /**
     * A key-value list to correlate each account with the Actual Budget account ID
     * @replaces ACTUAL_ACCOUNTS environment variable
     */
    accounts: Record<string, string>;
  };
};
```

#### accounts

A `JSON` key-value pair structure representing a mapping between two identifiers. The `key` represents the account ID as understood by moneyman (from web scraping the financial institutions) and the `value` is the account ID from your Actual Budget server.

Example:

```json
{
  "5897": "actual-account-id-123"
}
```

**Note:** Pending transactions will be skipped during import.
