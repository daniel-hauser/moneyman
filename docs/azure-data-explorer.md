# Export to Azure Data Explorer

Setup instructions:

1. Create a new data explorer cluster (can be done for free [here](https://docs.microsoft.com/en-us/azure/data-explorer/start-for-free))
2. Create a database within your cluster
3. Create a azure Service Principal following steps 1-7 [here](https://docs.microsoft.com/en-us/azure/data-explorer/provision-azure-ad-app#create-azure-ad-application-registration)
4. Allow the service to ingest data to the database by running this:

   ```kql
   .execute database script <|
   .add database ['<ADE_DATABASE_NAME>'] ingestors ('aadapp=<AZURE_APP_ID>;<AZURE_TENANT_ID>')
   ```

5. Create a table and ingestion mapping by running this: (Replace `<ADE_TABLE_NAME>` and `<ADE_INGESTION_MAPPING>`)

   ````kql
   .execute database script <|
   .drop table <ADE_TABLE_NAME> ifexists
   .create table <ADE_TABLE_NAME> (
      metadata: dynamic,
      transaction: dynamic
   )
   .create table <ADE_TABLE_NAME> ingestion json mapping '<ADE_INGESTION_MAPPING>' ```
   [
      { "column": "transaction", "path": "$.transaction" },
      { "column": "metadata", "path": "$.metadata" }
   ]
   ```
   ````

   Feel free to add more columns to the table and ingestion json mapping

Use the following configuration to setup:

```typescript
storage: {
  azure?: {
    /**
     * The azure application ID
     */
    appId: string;
    /**
     * The azure application secret key
     */
    appKey: string;
    /**
     * The tenant ID of your azure application
     */
    tenantId: string;
    /**
     * The name of the database
     */
    databaseName: string;
    /**
     * The name of the table
     */
    tableName: string;
    /**
     * The name of the JSON ingestion mapping
     */
    ingestionMapping: string;
    /**
     * The ingest URI of the cluster
     */
    ingestUri: string;
  };
};
```
