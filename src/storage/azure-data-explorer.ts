import { Readable } from "node:stream";
import { KustoConnectionStringBuilder } from "azure-kusto-data";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import {
  DataFormat,
  IngestClient,
  IngestionProperties,
} from "azure-kusto-ingest";
import { sendError } from "../notifier.js";
import { systemName } from "./../config.js";
import { createLogger } from "./../utils/logger.js";
import type KustoIngestClient from "azure-kusto-ingest/source/ingestClient";
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
  ADE_TENANT_ID,
  ADE_APP_ID,
  ADE_APP_KEY,
} = process.env;

export class AzureDataExplorerStorage implements TransactionStorage {
  ingestClient: KustoIngestClient;

  async init() {
    logger("init");

    const connection =
      KustoConnectionStringBuilder.withAadApplicationKeyAuthentication(
        ADE_INGEST_URI!,
        ADE_APP_ID!,
        ADE_APP_KEY!,
        ADE_TENANT_ID
      );

    const ingestionProps = new IngestionProperties({
      database: ADE_DATABASE_NAME,
      table: ADE_TABLE_NAME,
      format: DataFormat.MULTIJSON,
      ingestionMappingReference: ADE_INGESTION_MAPPING,
    });

    logger("Creating ingestClient");
    this.ingestClient = new IngestClient(connection, ingestionProps);
  }

  async saveTransactions(txns: Array<TransactionRow>) {
    logger(`Saving ${txns.length} transactions`);

    await this.init();

    const pending = txns.filter(
      (tx) => tx.status === TransactionStatuses.Pending
    ).length;

    const stats: SaveStats = {
      name: "AzureDataExplorer",
      sheetName: "TableName",
      replaced: 0,
      total: txns.length,
      added: txns.length,
      pending,
      existing: 0,
    };

    if (txns.length) {
      const stream = Readable.from(
        JSON.stringify(txns.map(this.transactionRow))
      );
      const res = await this.ingestClient.ingestFromStream(stream);

      if (res.errorCode) {
        sendError(
          `AzureDataExplorer.ingestFromStream returned ${res.errorCode}`
        );
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
