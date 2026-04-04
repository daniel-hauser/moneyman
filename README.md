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
4. Provide your configuration via `MONEYMAN_CONFIG` (inline JSON) or point `MONEYMAN_CONFIG_PATH` to a JSON/JSONC file
5. Run `npm run start`

#### From docker

1. Provide configuration via `MONEYMAN_CONFIG` (inline JSON) or mount a config file (recommended below)
2. `docker run --rm -e MONEYMAN_CONFIG="$(cat config.json)" ghcr.io/daniel-hauser/moneyman:latest`.

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

##### Logging

By default, the Docker image is configured with `MONEYMAN_UNSAFE_STDOUT=false` to prevent sensitive data from appearing in Docker logs. When enabled, the logs are redirected to `/tmp/moneyman.log` and sent to the Telegram chat automatically (if configured).

Logs sent to `logToPublicLog` bypass the redirection and will appear in the Docker logs.

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
accounts: Array<{
  companyId: string;
  password: string;
  /**
   * And any other fields required by the specific scraper
   */
}>;
```

#### Other configurations

| env variable name        | default               | description                                                                                           |
| ------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `TZ`                     | `'Asia/Jerusalem'`    | A timezone for the process - used for the formatting of the timestamp                                 |
| `MONEYMAN_CONFIG`        |                       | The JSON configuration for the process                                                                |
| `MONEYMAN_CONFIG_PATH`   |                       | Path to a JSON/JSONC configuration file (used if `MONEYMAN_CONFIG` is not set)                        |
| `SEND_NEW_CONFIG_TO_TG`  | `"false"`             | Set to `"true"` to send the current configuration as `config.txt` via Telegram for debugging purposes |
| `MONEYMAN_UNSAFE_STDOUT` | `"false"`             | Set to `"true"` to allow sensitive data to be printed to stdout instead of a log file                 |
| `MONEYMAN_LOG_FILE_PATH` | `"/tmp/moneyman.log"` | The file path where logs are stored when `MONEYMAN_UNSAFE_STDOUT` is set to `"false"`                 |

```typescript
options: {
  scraping: {
    /**
     * A comma separated list of providers to take from `accounts`. if empty, all accounts will be used
     * @default all accounts
     */
    accountsToScrape?: string[];
    /**
     * The amount of days back to scrape
     * @default 10
     */
    daysBack?: number;
    /**
     * The amount of months that will be scrapped in the future, starting from the day calculated using `daysBack`
     * @default 1
     */
    futureMonths?: number;
    /**
     * The hash type to use for the transaction hash. Can be `moneyman` or empty. The default will be changed to `moneyman` in the upcoming versions
     * @default ""
     */
    transactionHashType?: "" | "moneyman";
    /**
     * If set to `'true'`, enables the `additionalTransactionInformation` option in the underlying scraper, which may provide more detailed transaction data for some providers.
     * @default false
     */
    additionalTransactionInfo?: boolean;
    /**
     * A comma separated list of deprecations to hide
     * @default []
     */
    hiddenDeprecations?: string[];
    /**
     * An ExecutablePath for the scraper. if undefined defaults to system.
     */
    puppeteerExecutablePath?: string;
    /**
     * The maximum number of parallel scrapers to run
     * @default 1
     */
    maxParallelScrapers?: number;
    /**
     * Enable tracking of all domains accessed during scraping
     * @default false
     */
    domainTracking?: boolean;
  },
  logging: {
    /**
     * The URL to get IP information from
     * @default "https://ipinfo.io/json"
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
     */
    firewallSettings?: string[];
    /**
     * If truthy, all domains with no rule will be blocked by default. If falsy, all domains will be allowed by default
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
       */
      apiKey: string;
      /**
       * The chat id
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

### Destinations

| Destination | Description |
| ----------- | ----------- |
| [Telegram](./docs/telegram.md) | Send transactions as a JSON file to your Telegram chat |
| [Google Sheets](./docs/google-sheets.md) | Export transactions to a Google Sheets spreadsheet |
| [Azure Data Explorer](./docs/azure-data-explorer.md) | Export transactions to an Azure Data Explorer cluster |
| [YNAB](./docs/ynab.md) | Export transactions to YNAB (YouNeedABudget) |
| [Buxfer](./docs/buxfer.md) | Export transactions to Buxfer |
| [Actual Budget](./docs/actual-budget.md) | Export transactions to Actual Budget |
| [PostgreSQL](./docs/postgresql.md) | Persist transactions in a PostgreSQL database |
| [Web Post](./docs/web-post.md) | Export transactions as a POST request to a web address |
| [JSON files](./docs/json.md) | Export transactions to local JSON files |
| [Excel on OneDrive](./docs/excel-onedrive.md) | Export transactions to Excel on OneDrive (WIP) |
