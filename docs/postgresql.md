# Export to PostgreSQL

Persist transactions in a PostgreSQL database for analytics or downstream integrations.

- moneyman creates (or reuses) a dedicated schema named `moneyman` by default. You can override the schema name with the `schema` property if you prefer a different dedicated schema.
- Within that schema two tables are maintained:
  - `transactions` – one row per completed transaction, upserted by `unique_id`.
  - `transactions_raw` – an append-only log that stores every scrape (including pending transactions) together with the original JSON payload.

Use the following configuration to setup:

```typescript
storage: {
  sql?: {
    /**
     * PostgreSQL connection string (for example: "postgresql://user:pass@host:5432/moneyman")
     */
    connectionString: string;
    /**
     * Optional dedicated schema for moneyman data. Defaults to "moneyman".
     */
    schema?: string;
  };
};
```

> [!TIP]
> Grant the configured user rights to create the schema (first run) and manage the two tables.
