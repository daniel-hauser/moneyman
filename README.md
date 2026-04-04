# moneyman

Automatically save transactions from all major Israeli banks and credit card companies, using GitHub Actions (or a self-hosted Docker image).

Powered by [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers).

## Why?

Having all your data in one place lets you view all of your expenses in a beautiful dashboard like [Looker Studio](https://lookerstudio.google.com), [Azure Data Explorer dashboards](https://docs.microsoft.com/en-us/azure/data-explorer/azure-data-explorer-dashboards), [Microsoft Power BI](https://powerbi.microsoft.com/) and [YNAB](https://www.ynab.com/).

## Important notes

This app requires some technical skills. If you prefer a GUI app you can use [Caspion](https://github.com/brafdlog/caspion) instead.

> [!WARNING]
> The current implementation assumes that you run the code on secure and trusted computers. Storing all your financial data and passwords in one place is risky — especially with more than read-only access.
>
> By using moneyman, you acknowledge that you are taking full responsibility for the code quality and will use it only after you review the code and validate that it's secure.
>
> **Please use a proper secret management solution to store and pass credentials.**

## How to run

### Cloud (GitHub Actions)

Moneyman can be configured to periodically run automatically, using the [`scrape`](./.github/workflows/scrape.yml) GitHub workflow.

By default, this workflow will run twice daily at 10:05 and 22:05 UTC (12:05 and 00:05 or 13:05 and 01:05 in Israel time, depending on DST).

Since logs are public for public repos, most logs are off by default and the progress and error messages will be sent via Telegram.

#### Setup

1. Fork the [moneyman](https://github.com/daniel-hauser/moneyman) repo to your account
2. Add the `MONEYMAN_CONFIG` to the [actions secrets](../../settings/secrets/actions) of the forked repo
   - Use [`config.example.jsonc`](./config.example.jsonc) as a starting point and add configurations for your selected storage
   - For better logging, add the [Telegram configuration](./docs/telegram-notifications.md) so moneyman can send private logs and errors
3. Build and upload the Docker image using the "Run workflow" button in [workflows/build.yml](../../actions/workflows/build.yml)
4. Wait for the [scrape workflow](../../actions/workflows/scrape.yml) to be triggered by GitHub

### Locally

<details>
<summary><b>From code</b></summary>

1. Clone this repo
2. Run `npm install`
3. Run `npm run build`
4. Provide your configuration via `MONEYMAN_CONFIG` (inline JSON) or point `MONEYMAN_CONFIG_PATH` to a JSON/JSONC file
5. Run `npm start`

</details>

<details>
<summary><b>From Docker</b></summary>

1. Provide configuration via `MONEYMAN_CONFIG` (inline JSON) or mount a config file (recommended below)
2. `docker run --rm -e MONEYMAN_CONFIG="$(cat config.json)" ghcr.io/daniel-hauser/moneyman:latest`

#### Using a configuration file (recommended)

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

#### Logging

By default, the Docker image is configured with `MONEYMAN_UNSAFE_STDOUT=false` to prevent sensitive data from appearing in Docker logs. When enabled, the logs are redirected to `/tmp/moneyman.log` and sent to the Telegram chat automatically (if configured).

Logs sent to `logToPublicLog` bypass the redirection and will appear in the Docker logs.

</details>

### Debug

Moneyman uses the [debug](https://www.npmjs.com/package/debug) package for debug messages under the `moneyman:` namespace.

To enable debug output, set the `DEBUG` environment variable to `moneyman:*`.

## Settings

### Accounts

Moneyman uses a JSON configuration for all settings. You can provide configuration in two ways:

1. **`MONEYMAN_CONFIG` environment variable**: The JSON configuration as a string
2. **`MONEYMAN_CONFIG_PATH` environment variable**: Path to a JSON or JSONC configuration file

The configuration file approach is recommended for Docker/Kubernetes environments and supports JSON with Comments (JSONC) for better readability.

> [!TIP]
> See [`config.example.jsonc`](./config.example.jsonc) for a complete example configuration file with comments.

#### Accounts Configuration

A JSON array of accounts following [this](https://github.com/eshaham/israeli-bank-scrapers#specific-definitions-per-scraper) schema with an additional `companyId` field set to a [companyType](https://github.com/eshaham/israeli-bank-scrapers/blob/master/src/definitions.ts#L5:L23) value.

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

Moneyman supports domain tracking and firewall rules to control which domains each scraper can access. See [Domain Security](./docs/domain-security.md) for setup instructions.

### Get notified in Telegram

We use Telegram to send you the update status, including support for OTP 2FA with OneZero accounts. See [Telegram Notifications](./docs/telegram-notifications.md) for setup instructions.

### Destinations

| Destination                                          | Description                                            |
| ---------------------------------------------------- | ------------------------------------------------------ |
| [Telegram](./docs/telegram.md)                       | Send transactions as a JSON file to your Telegram chat |
| [Google Sheets](./docs/google-sheets.md)             | Export transactions to a Google Sheets spreadsheet     |
| [Azure Data Explorer](./docs/azure-data-explorer.md) | Export transactions to an Azure Data Explorer cluster  |
| [YNAB](./docs/ynab.md)                               | Export transactions to YNAB (YouNeedABudget)           |
| [Buxfer](./docs/buxfer.md)                           | Export transactions to Buxfer                          |
| [Actual Budget](./docs/actual-budget.md)             | Export transactions to Actual Budget                   |
| [PostgreSQL](./docs/postgresql.md)                   | Persist transactions in a PostgreSQL database          |
| [Web Post](./docs/web-post.md)                       | Export transactions as a POST request to a web address |
| [JSON files](./docs/json.md)                         | Export transactions to local JSON files                |
| [Excel on OneDrive](./docs/excel-onedrive.md)        | Export transactions to Excel on OneDrive (WIP)         |
