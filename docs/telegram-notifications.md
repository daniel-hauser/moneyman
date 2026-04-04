# Get notified in Telegram

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
