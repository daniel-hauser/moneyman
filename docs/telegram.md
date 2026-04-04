# Export to Telegram

By default, when Telegram notifications are configured, moneyman will also send all scraped transactions as a JSON file to your Telegram chat. This behavior can be controlled independently from the notification messages.

Use the following configuration to setup:

```typescript
storage: {
  telegram?: {
    /**
     * Whether to send transactions as a JSON file to the Telegram chat.
     * When enabled, all scraped transactions will be sent to your Telegram chat.
     * This is independent of notification messages (errors, progress, etc.) which
     * are controlled by options.notifications.telegram.
     * @default true
     */
    enabled: boolean;
  };
};
```

**Note:** This requires Telegram notifications to be configured in `options.notifications.telegram`. The `enabled` setting only controls whether transaction files are sent; notification messages (progress, errors, etc.) are always sent when Telegram is configured.

To disable transaction file exports while keeping notifications:

```json
{
  "storage": {
    "telegram": {
      "enabled": false
    }
  },
  "options": {
    "notifications": {
      "telegram": {
        "apiKey": "your-telegram-bot-token",
        "chatId": "your-chat-id"
      }
    }
  }
}
```
