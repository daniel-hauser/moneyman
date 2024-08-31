import { Readable } from "node:stream";
import { KustoConnectionStringBuilder } from "azure-kusto-data";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import {
  DataFormat,
  IngestClient,
  IngestionProperties,
} from "azure-kusto-ingest";
import { sendError } from "../notifier.js";
import { systemName } from "../config/config.js";
import { createLogger } from "./../utils/logger.js";
import type KustoIngestClient from "azure-kusto-ingest/types/src/ingestClient.js";
import type {
  SaveStats,
  TransactionRow,
  TransactionStorage,
} from "../types.js";

const logger = createLogger("azure-data-explorer");

const {
  ADE_DATABASE_NAME,
  ADE_TABLE_NAME,
  ADE_INGESTION_MAPPING,
  ADE_INGEST_URI,
  AZURE_TENANT_ID,
  AZURE_APP_ID,
  AZURE_APP_KEY,
} = process.env;

export class AzureDataExplorerStorage implements TransactionStorage {
  ingestClient: KustoIngestClient;

  async init() {
    logger("init");

    try {
      const connection =
        KustoConnectionStringBuilder.withAadApplicationKeyAuthentication(
          ADE_INGEST_URI!,
          AZURE_APP_ID!,
          AZURE_APP_KEY!,
          AZURE_TENANT_ID,
        );

      const ingestionProps = new IngestionProperties({
        database: ADE_DATABASE_NAME,
        table: ADE_TABLE_NAME,
        format: DataFormat.MULTIJSON,
        ingestionMappingReference: ADE_INGESTION_MAPPING,
      });

      logger("Creating ingestClient");
      this.ingestClient = new IngestClient(connection, ingestionProps);
    } catch (e) {
      sendError(e, "AzureDataExplorerStorage");
    }
  }
  canSave() {
    return Boolean(
      AZURE_APP_ID &&
        AZURE_APP_KEY &&
        AZURE_TENANT_ID &&
        ADE_DATABASE_NAME &&
        ADE_TABLE_NAME &&
        ADE_INGESTION_MAPPING &&
        ADE_INGEST_URI,
    );
  }

  async saveTransactions(txns: Array<TransactionRow>) {
    logger(`Saving ${txns.length} transactions`);

    const pending = txns.filter(
      (tx) => tx.status === TransactionStatuses.Pending,
    ).length;

    const stats: SaveStats = {
      name: "AzureDataExplorer",
      table: ADE_TABLE_NAME!,
      total: txns.length,
      added: txns.length,
      pending,
      skipped: 0,
      existing: NaN,
    };

    if (!this.ingestClient) {
      await sendError(
        "Called without initializing",
        "AzureDataExplorerStorage.saveTransactions",
      );
    } else if (txns.length) {
      const stream = Readable.from(
        JSON.stringify(txns.map(this.transactionRow)),
      );
      try {
        await this.ingestClient.ingestFromStream(stream);
      } catch (e) {
        await sendError(e, "AzureDataExplorer.ingestFromStream");
      }
    }

    return stats;
  }

  private transactionRow(transaction: TransactionRow) {
    return {
      transaction,
      metadata: {
        scrapedBy: systemName,
        scrapedAt: new Date().toISOString(),
      },
    };
  }
}
