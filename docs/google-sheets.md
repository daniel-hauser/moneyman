# Export to Google Sheets

Export transactions to a Google Sheets spreadsheet.

Setup instructions:

1. Follow the instructions [here](https://theoephraim.github.io/node-google-spreadsheet/#/guides/authentication?id=setting-up-your-quotapplicationquot) to create a google service account.
2. Create a [new sheet](https://sheets.new/) and share it with your service account using the `serviceAccountEmail`.
3. Create a sheet named `_moneyman` with the following headers in the first row:
   | date | amount | description | memo | category | account | hash | comment | scraped at | scraped by | identifier | chargedCurrency | raw |

Use the following configuration to setup:

```typescript
storage: {
  googleSheets?: {
    /**
     * The super secret api key of your service account
     */
    serviceAccountPrivateKey: string;
    /**
     * The service account's email address
     */
    serviceAccountEmail: string;
    /**
     * The id of the spreadsheet you shared with the service account
     */
    sheetId: string;
    /**
     * The name of the sheet you want to add the transactions to
     * @default "_moneyman"
     */
    worksheetName: string;
  };
};
```
