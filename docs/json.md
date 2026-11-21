# Export JSON files

Export transactions to json file.

Each transaction's `scrapedAt` is the ISO timestamp captured at the start of
its scrape run. It stays unchanged if saving is delayed; the filename timestamp
records when the export was written.

Use the following configuration to setup:

```typescript
storage: {
  localJson?: {
    /**
     * If truthy, all transaction will be saved to a `<process cwd>/output/<ISO timestamp>.json` file
     */
    enabled: boolean;
    /**
     * Optional: a filesystem path where JSON files will be saved.
     * If not provided, files are written to `<process.cwd()>/output`.
     * Files are named using an ISO timestamp (colons are replaced with `_`),
     * for example: `2025-11-23T12_34_56.789Z.json`.
     */
    path?: string;
  };
};
```
