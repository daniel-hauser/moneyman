import { Readable } from "node:stream";
import { KustoConnectionStringBuilder } from "azure-kusto-data";
import {
  DataFormat,
  IngestClient,
  IngestionProperties,
} from "azure-kusto-ingest";
import { sendError } from "../notifier.js";
import { systemName, type MoneymanConfig } from "../../config.js";
import { createLogger } from "../../utils/logger.js";
import type { KustoIngestClient } from "azure-kusto-ingest/types/src/ingestClient.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { createSaveStats } from "../saveStats.js";
import assert from "node:assert";

const logger = createLogger("azure-data-explorer");

export class AzureDataExplorerStorage implements TransactionStorage {
  ingestClient: KustoIngestClient;

  constructor(private config: MoneymanConfig) {}

  init() {
    logger("init");

    try {
      const adxConfig = this.config.storage.azure;
      assert(adxConfig, "Azure Data Explorer configuration not found");

      const connection =
        KustoConnectionStringBuilder.withAadApplicationKeyAuthentication(
          adxConfig.ingestUri,
          adxConfig.appId,
          adxConfig.appKey,
          adxConfig.tenantId,
        );

      const ingestionProps = new IngestionProperties({
        database: adxConfig.databaseName,
        table: adxConfig.tableName,
        format: DataFormat.MULTIJSON,
        ingestionMappingReference: adxConfig.ingestionMapping,
      });

      logger("Creating ingestClient");
      this.ingestClient = new IngestClient(connection, ingestionProps);
    } catch (e) {
      sendError(e, "AzureDataExplorerStorage");
    }
  }

  canSave() {
    return Boolean(this.config.storage.azure);
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    logger(`Saving ${txns.length} transactions`);
    this.init();

    const stats = createSaveStats(
      "AzureDataExplorer",
      this.config.storage.azure?.tableName || "transactions",
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
