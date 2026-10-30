# Get notified in Telegram

We use telegram to send you the update status.

Each run is reported in a single message that is edited as the run progresses: scraping status, a summary of the scraped transactions and one row per storage. At the end of every run, a self-contained `report.html` is sent with the final status, full errors, and failure screenshots embedded. The report works offline; long sections and screenshots can be expanded in a browser. To understand update bursts and rate limiting, enable `DEBUG=moneyman:report`: a single `report stats {...}` line (renders, requests, skipped unchanged renders, 429s, largest burst of mutations) is logged at the end of each run.

The HTML report shows compact run details, including a localized short start date and time (hover for the full timestamp), and account/storage tables without repeating account results as scraper status. Expand a failed account or storage's status to see its full error; errors wrap within stable table columns. Storage tables show **Name**, with the destination beneath it when available, **Status**, and one wrapping **Summary** with every transaction count (including zeroes) and save time; step progression appears underneath as a compact flow, and wide tables scroll horizontally. **Transactions (N)** displays immediately as a scrollable table with sticky headers, using your browser's short date format (hover for the full timestamp). **Search transactions** filters all displayed columns using the same wildcards as log search and updates the visible count. Date, Amount, and Account header buttons toggle ascending/descending order; invalid dates stay last and tied values retain original order. Filtering preserves your chosen sort. The **Download transactions as JSON** icon always saves every original transaction from successful accounts in original order, augmented with `companyId` and `accountNumber`, as `transactions.json`, regardless of filtering or sorting. Screenshots appear below the account results in **Accounts** only when image data is available, collapsed by default under **Screenshots (N)**, including on runs without account results. Expand them for small uncropped thumbnails, then click a thumbnail for a full-size dialog; close it with **Close screenshot**, Escape, or a click outside.

In a current browser, **Search logs** filters lines case-insensitively and highlights matching spans. Search text is literal except for Excel-style wildcards: `*` matches any sequence and `?` matches one character; use `~*`, `~?`, and `~~` for a literal star, question mark, and tilde. Matches do not cross line endings. Clear the search to restore all lines; **Download logs**, to the right of the search box, always saves the complete, original text as `logs.txt`, including whitespace and line endings.

All report styles and scripts are inline and work without a network connection. A Content Security Policy blocks network resource loads and connections, permits only the report's hash-approved scripts and styles, and allows embedded screenshot images. It does not restrict top-level navigation or user-initiated downloads.

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
      /**
       * Minimum time in milliseconds between edits of the status message.
       * Values below 250 are raised to 250 to stay within Telegram's rate limits.
       * @default 500
       */
      updateIntervalMs?: number;
    };
  };
};
```

## Commands

When moneyman runs in [long running mode](../README.md#long-running-mode)
(`MONEYMAN_LONG_RUNNING=true`) it stays connected to Telegram and listens for commands.
Only the configured `chatId` can use them — messages from any other chat are ignored.

| Command            | Description                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `/scrape`          | Run a scrape right now (`/fetch` works as an alias)                                                |
| `/refresh_secrets` | Refresh the secret-provider configuration without starting a scrape                                |
| `/status`          | Report whether a scrape is running, how the last one ended and when the next scheduled run happens |
| `/help`            | List the available commands                                                                        |

`/scrape` replies immediately, then progress and the summary are sent to the same chat while the
scrape runs. Errors and screenshots are included in the final HTML report. Automatic runs are configured with
[`options.scheduling.cron`](../README.md#other-configurations).

`/refresh_secrets` is registered and listed only when a [secret provider](./secret-providers.md) is configured. It fetches and validates bank/storage credentials and per-run settings without changing the running Telegram bot or schedule. Manual refreshes can run alongside scraping or other refreshes without changing an active scrape's configuration. Duplicate scrape requests still receive an already-running response.

## Using OTP 2FA with OneZero Accounts

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
