# Export to web address

Export transactions as a POST request to a web address.

The transactions will be sent as a JSON array in the body of the request with the following structure:

```
{
    /**
     * Date in "dd/mm/yyyy" format
     */
    date: string,
    amount: number,
    description: string,
    memo: string,
    category: string,
    account: string,
    hash: string,
    comment: string | undefined,
    /**
     * Scraped date in "YYYY-MM-DD" format
     */
    "scraped at": string,
    "scraped by": string,
    identifier: string,
    chargedCurrency: string | undefined,
}
```

Use the following configuration to setup:

```typescript
storage: {
  webPost?: {
    /**
     * The URL to post to
     */
    url: string;
    /**
     * The Authorization header value (i.e. `Bearer *****`, but can use any schema)
     */
    authorizationToken: string;
  };
};
```

> [!IMPORTANT]
> Be sure to post only to a trusted server.
