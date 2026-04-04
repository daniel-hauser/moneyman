# Export to [Actual Budget](https://actualbudget.org/)

Export transactions directly to your Actual Budget server.

Use the following configuration to setup:

```typescript
storage: {
  actual?: {
    /**
     * The URL of your Actual Budget server
     */
    serverUrl: string;
    /**
     * The password for your Actual Budget server
     */
    password: string;
    /**
     * The ID of the budget where you want to import the data
     */
    budgetId: string;
    /**
     * A key-value list to correlate each account with the Actual Budget account ID
     */
    accounts: Record<string, string>;
  };
};
```

## accounts

A `JSON` key-value pair structure representing a mapping between two identifiers. The `key` represents the account ID as understood by moneyman (from web scraping the financial institutions) and the `value` is the account ID from your Actual Budget server.

Example:

```json
{
  "5897": "actual-account-id-123"
}
```

**Note:** Pending transactions will be skipped during import.

## Troubleshooting

- **`out-of-sync-migrations` error** — The budget database and the `@actual-app/api` version are out of sync. Ensure your Actual Budget server and moneyman's `@actual-app/api` dependency use compatible versions. Update both to their latest releases, or pin them to matching versions. See [actualbudget/actual#3656](https://github.com/actualbudget/actual/issues/3656) for context.

  You may see a generic error in the logs (e.g. `Failed to initialize Actual Budget: No budget file is open`). The underlying cause appears earlier in the console as `Error updating Error: out-of-sync-migrations` — look for that when diagnosing.
