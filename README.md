# moneyman

Automatically add transactions from all major Israeli banks and credit card companies to a online worksheet

Internally we use [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) to scrape the data.

## Why?

Having all your data in one place lets you view all of your expenses in a beautiful dashboard like [Google Data Studio](https://datastudio.google.com) and [Microsoft Power BI](https://powerbi.microsoft.com/)

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
2. Add the following secrets to the [actions secrets](https://github.com/daniel-hauser/moneyman/settings/secrets/actions) of the forked repo
   1. `ACCOUNTS_JSON` So moneyman
   2. `GOOGLE_SHEET_ID`
   3. `GOOGLE_SERVICE_ACCOUNT_[EMAIL, PRIVATE_KEY]`
   4. `TELEGRAM_API_[KEY, CHAT_ID]`
3. Wait for the workflow to be triggered by github

### locally

#### From code

1. Clone this repo
2. Run `npm install`
3. Add your env variables (you can add them in a `.env` file in the project's root directory)
4. Run `npm run start`

#### From docker

1. Define the environment variables in a `.env` file
2. `docker run --rm --env-file ".env" ghcr.io/daniel-hauser/moneyman:latest`

## Settings

### Add accounts and scrape

Use the following env vars to setup the data fetching.

| Name                 | description                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNTS_JSON`      | A json array of accounts following [this](https://github.com/eshaham/israeli-bank-scrapers#specific-definitions-per-scraper) schema |
| `ACCOUNTS_TO_SCRAPE` | [Optional] A comma separated list of providers to take from `ACCOUNTS_JSON`, default value is all accounts                          |
| `DAYS_BACK`          | The amount of days back to scrape                                                                                                   |
| `TZ`                 | A timezone for the process - used for the formatting of the timestamp                                                               |

### Get notified in telegram

We use telegram to send you the update status.

1. Create your bot following [this](https://core.telegram.org/bots#creating-a-new-bot)
2. Open this url `https://api.telegram.org/bot<TELEGRAM_API_KEY>/getUpdates`
3. Send a message to your bot and fnd the chat id

| Name               | description                                     |
| ------------------ | ----------------------------------------------- |
| `TELEGRAM_API_KEY` | The super secret api key you got from BotFather |
| `TELEGRAM_CHAT_ID` | The chat id                                     |

TODO: Add a way to send a message to the bot to connect?

### Export to google sheets

1. Follow the instructions [here](https://theoephraim.github.io/node-google-spreadsheet/#/getting-started/authentication?id=service-account) to create a google service account.
2. Create a [new sheet](https://sheets.new/) and share it with your service account using the `GOOGLE_SERVICE_ACCOUNT_EMAIL`.

| Name                                 | description                                                   |
| ------------------------------------ | ------------------------------------------------------------- |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | The super secret api key of your service account              |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`       | The service account's email address                           |
| `GOOGLE_SHEET_ID`                    | The id of the spreadsheet you shared with the service account       |
| `WORKSHEET_NAME`                     | The name of the sheet you want to add the transactions to |

### Debug

We use the [debug](https://www.npmjs.com/package/debug) package for debug messages under the `moneyman:` namespace.

If you want to see them, use the `DEBUG` environment variable with the value `moneyman:*`

### Export to excel on one drive

WIP
