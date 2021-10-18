# money

Automatically add transactions from all major Israeli banks and credit card companies to a online worksheet (both google sheets and one drive are supported).

Internally we use [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) to scrape the data.

## Why?

Having all your data in one place lets you view all of your expenses in a beautiful dashboard (like [Google Data Studio](https://datastudio.google.com) and [Microsoft Power BI](https://powerbi.microsoft.com/)

## Run

### Cloud

TODO: Add instructions?

### locally

1. Clone this repo
2. Run `npm install`
3. Add your env variables (you can add them in a `.env` file in the project's root directory)
4. Run `npm run start`

TODO: Add docker build & run script

## Setup

This app requires technical skills and a place to deploy your docker container.

If you prefer a GUI app, you can use [Caspion](https://github.com/brafdlog/caspion) instead.

**Important:**
The current implementation assumes that you run the code on a secures and trusted computers.
**Its a bad idea** to put all of your financial data in one place, especially with more then read only access.

**Please use a secret management solution (azure secrets, docker secrets) to save and pass the environment variables**

### Add accounts

Use the following env vars to setup the data fetching.

| Name            | description                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNTS_JSON` | A json array of accounts following [this](https://github.com/eshaham/israeli-bank-scrapers#specific-definitions-per-scraper) schema |
| `DAYS_BACK`     | The amount of days back to scrape                                                                                                   |

### Get notified in telegram

We use telegram to send you the update status.

1. Create you bot following [this](https://core.telegram.org/bots#creating-a-new-bot)
2. Open this url `https://api.telegram.org/bot<TELEGRAM_API_KEY>/getUpdates`
3. Send a message to your bot and fnd the chat id

| Name               | description                                     |
| ------------------ | ----------------------------------------------- |
| `TELEGRAM_API_KEY` | The super secret api key you got from BotFather |
| `TELEGRAM_CHAT_ID` | The chat id                                     |

TODO: Add a way to send a message to the bot to connect

### Export to google sheets

1. Follow the instructions [here](https://theoephraim.github.io/node-google-spreadsheet/#/getting-started/authentication?id=service-account) to create a google service account.
2. Create a [new sheet](https://sheets.new/) and share it with your service account using the `GOOGLE_SERVICE_ACCOUNT_EMAIL`.

| Name                           | description                                                   |
| ------------------------------ | ------------------------------------------------------------- |
| `GOOGLE_PRIVATE_KEY`           | The super secret api key of your service account              |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | The service account's email address                           |
| `GOOGLE_SHEET_ID`              | The id of the sheet you shared with the service account       |
| `WORKSHEET_NAME`               | The name of the worksheet you want to add the transactions to |

### Export to excel on one drive

TBD
