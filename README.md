# moneyman

Automatically add transactions from all major Israeli banks and credit card companies to a online worksheet

Internally we use [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) to scrape the data.

## Why?

Having all your data in one place lets you view all of your expenses in a beautiful dashboard like [Google Data Studio](https://datastudio.google.com), [Azure Data Explorer dashboards](https://docs.microsoft.com/en-us/azure/data-explorer/azure-data-explorer-dashboards) and [Microsoft Power BI](https://powerbi.microsoft.com/)

## Important notes

This app requires some technical skills, if you prefer a GUI app you can use [Caspion](https://github.com/brafdlog/caspion) instead.

**Important:**
The current implementation assumes that you run the code on secure and trusted computers.

**It’s a bad idea**
to put all your financial data and passwords in one place, especially with more than read-only access.

By using moneyman, you acknowledge that you are taking full responsibility for the code quality and will use it only after you review the code and validate that it’s secure.

**Please use a proper secret management solution to save and pass the environment variables**

## How to run

### Cloud

Moneyman can be configured to periodically run automatically, using the [`scrape`](./.github/workflows/scrape.yml) github workflow.

By default, this workflow will run every other day.

Since logs are public for public repos, most logs are off by default and the progress and error messages will be sent in telegram.

#### Setup

1. Fork the [moneyman](https://github.com/daniel-hauser/moneyman) repo to your account
2. Add the following secrets to the [actions secrets](../../settings/secrets/actions) of the forked repo
   1. [`ACCOUNTS_JSON`](#add-accounts-and-scrape) - So moneyman can login to your accounts
   2. [`TELEGRAM_API_[KEY, CHAT_ID]`](#get-notified-in-telegram) - So moneyman can send private logs and errors
   3. The environment variables of the storage you want to use
3. Wait for the workflow to be triggered by github

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

### Add accounts and scrape

Use the following env vars to setup the data fetching:

#### ACCOUNTS_JSON

A json array of accounts following [this](https://github.com/eshaham/israeli-bank-scrapers#specific-definitions-per-scraper) schema with an additional `companyId` field with a [companyType](https://github.com/eshaham/israeli-bank-scrapers/blob/master/src/definitions.ts#L5:L23) as the value.

Example:

```json
[
  { "companyId": "hapoalim", "userCode": "AB1234", "password": "p@ssword" },
  { "companyId": "visaCal", "username": "Ploni Almoni", "password": "p@ssword" }
]
```

#### Other configurations

| env variable name    | default            | description                                                                                                  |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `ACCOUNTS_TO_SCRAPE` | `[]`               | A comma separated list of providers to take from `ACCOUNTS_JSON`. if empty, all accounts will be used        |
| `DAYS_BACK`          | `10`               | The amount of days back to scrape                                                                            |
| `TZ`                 | `'Asia/Jerusalem'` | A timezone for the process - used for the formatting of the timestamp                                        |
| `FUTURE_MONTHS`      | `1`                | The amount of months that will be scrapped in the future, starting from the day calculated using `DAYS_BACK` |

### Get notified in telegram

We use telegram to send you the update status.

1. Create your bot following [this](https://core.telegram.org/bots#creating-a-new-bot)
2. Open this url `https://api.telegram.org/bot<TELEGRAM_API_KEY>/getUpdates`
3. Send a message to your bot and fnd the chat id

Use the following env vars to setup:

| env variable name  | description                                     |
| ------------------ | ----------------------------------------------- |
| `TELEGRAM_API_KEY` | The super secret api key you got from BotFather |
| `TELEGRAM_CHAT_ID` | The chat id                                     |

TODO: Add a way to send a message to the bot to connect?

### Export to Azure Data Explorer

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

Use the following env vars to setup:

| env variable name       | description                             |
| ----------------------- | --------------------------------------- |
| `AZURE_APP_ID`          | The azure application ID                |
| `AZURE_APP_KEY`         | The azure application secret key        |
| `AZURE_TENANT_ID`       | The tenant ID of your azure application |
| `ADE_DATABASE_NAME`     | The name of the database                |
| `ADE_TABLE_NAME`        | The name of the table                   |
| `ADE_INGESTION_MAPPING` | The name of the JSON ingestion mapping  |
| `ADE_INGEST_URI`        | The ingest URI of the cluster           |

### Export JSON files

Export transactions to json file.

Use the following env vars to setup:

| env variable name    | description                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `LOCAL_JSON_STORAGE` | If truthy, all transaction will be saved to a `<process cwd>/output/<ISO timestamp>.json` file |

### Export to excel on OneDrive

WIP

### Export to google sheets

1. Follow the instructions [here](https://theoephraim.github.io/node-google-spreadsheet/#/getting-started/authentication?id=service-account) to create a google service account.
2. Create a [new sheet](https://sheets.new/) and share it with your service account using the `GOOGLE_SERVICE_ACCOUNT_EMAIL`.

Use the following env vars to setup:

| env variable name                    | description                                                   |
| ------------------------------------ | ------------------------------------------------------------- |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | The super secret api key of your service account              |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`       | The service account's email address                           |
| `GOOGLE_SHEET_ID`                    | The id of the spreadsheet you shared with the service account |
| `WORKSHEET_NAME`                     | The name of the sheet you want to add the transactions to     |
