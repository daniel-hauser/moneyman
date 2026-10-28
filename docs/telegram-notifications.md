# Get notified in Telegram

We use telegram to send you the update status.

Each run is reported in a single message that is edited as the run progresses: scraping status, a summary of the scraped transactions and one row per storage. Details (account status, storage steps, skipped and highlighted transactions) are collapsed in expandable quotes. If the message had to be shortened (long errors or Telegram's 4096 character limit), the full report is also sent once at the end of the run as `status.html` (open it in a browser). Errors are sent as separate messages. To understand update bursts and rate limiting, enable `DEBUG=moneyman:report`: a single `report stats {...}` line (renders, requests, skipped unchanged renders, 429s, largest burst of mutations) is logged at the end of each run.

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

| Command   | Description                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------- |
| `/scrape` | Run a scrape right now (`/fetch` works as an alias)                                                |
| `/status` | Report whether a scrape is running, how the last one ended and when the next scheduled run happens |
| `/help`   | List the available commands                                                                        |

`/scrape` replies immediately, then the regular notifications (progress, summary, errors) are sent
to the same chat while the scrape runs. Automatic runs are configured with
[`options.scheduling.times`](../README.md#other-configurations).

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
