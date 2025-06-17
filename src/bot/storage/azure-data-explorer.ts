import { Readable } from "node:stream";
import { KustoConnectionStringBuilder } from "azure-kusto-data";
import {
  DataFormat,
  IngestClient,
  IngestionProperties,
} from "azure-kusto-ingest";
import { sendError } from "../notifier.js";
import { systemName } from "../../config.js";
import { createLogger } from "../../utils/logger.js";
import type { KustoIngestClient } from "azure-kusto-ingest/types/src/ingestClient.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { createSaveStats } from "../saveStats.js";
import { config } from "../../config.js";

const logger = createLogger("azure-data-explorer");

export class AzureDataExplorerStorage implements TransactionStorage {
  ingestClient: KustoIngestClient;

  init() {
    logger("init");

    try {
      const connection =
        KustoConnectionStringBuilder.withAadApplicationKeyAuthentication(
          config.ADE_INGEST_URI!,
          config.AZURE_APP_ID!,
          config.AZURE_APP_KEY!,
          config.AZURE_TENANT_ID,
        );

      const ingestionProps = new IngestionProperties({
        database: config.ADE_DATABASE_NAME,
        table: config.ADE_TABLE_NAME,
        format: DataFormat.MULTIJSON,
        ingestionMappingReference: config.ADE_INGESTION_MAPPING,
      });

      logger("Creating ingestClient");
      this.ingestClient = new IngestClient(connection, ingestionProps);
    } catch (e) {
      sendError(e, "AzureDataExplorerStorage");
    }
  }

  canSave() {
    return Boolean(
      config.AZURE_APP_ID &&
        config.AZURE_APP_KEY &&
        config.AZURE_TENANT_ID &&
        config.ADE_DATABASE_NAME &&
        config.ADE_TABLE_NAME &&
        config.ADE_INGESTION_MAPPING &&
        config.ADE_INGEST_URI,
    );
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    logger(`Saving ${txns.length} transactions`);
    this.init();

    const stats = createSaveStats(
      "AzureDataExplorer",
      config.ADE_TABLE_NAME,
      txns,
    );

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
        await Promise.all([
          onProgress("Ingesting"),
          this.ingestClient.ingestFromStream(stream),
        ]);
        stats.added = txns.length;
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
