# Export to YNAB (YouNeedABudget)

To export your transactions directly to `YNAB` you need to use the following configuration to setup:

```typescript
storage: {
  ynab?: {
    /**
     * The `YNAB` access token. Check [YNAB documentation](https://api.ynab.com/#authentication) about how to obtain it
     */
    token: string;
    /**
     * The `YNAB` budget ID where you want to import the data. You can obtain it opening [YNAB application](https://app.ynab.com/) on a browser and taking the budget `UUID` in the `URL`
     */
    budgetId: string;
    /**
     * A key-value list to correlate each account with the `YNAB` account `UUID`
     */
    accounts: Record<string, string>;
  };
};
```

## accounts

A `JSON` key-value pair structure representing a mapping between two identifiers. The `key` represent the account ID as is understood by moneyman and the `value` it's the `UUID` visible in the YNAB URL when an account is selected.

For example, in the URL:
`https://app.ynab.com/22aa9fcd-93a9-47e9-8ff6-33036b7c6242/accounts/ba2dd3a9-b7d4-46d6-8413-8327203e2b82` the account UUID is the second `UUID`.

Example:

```json
{
  "5897": "ba2dd3a9-b7d4-46d6-8413-8327203e2b82"
}
```
