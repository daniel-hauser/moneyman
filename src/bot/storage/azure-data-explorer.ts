import { Readable } from "node:stream";
import { KustoConnectionStringBuilder } from "azure-kusto-data";
import {
  DataFormat,
  IngestClient,
  IngestionProperties,
} from "azure-kusto-ingest";
import { sendError } from "../notifier.js";
import { systemName, type MoneymanConfig } from "../../config.js";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { spanEvent } from "../../utils/telemetry.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { createSaveStats } from "../saveStats.js";
import assert from "node:assert";

export class AzureDataExplorerStorage implements TransactionStorage {
  ingestClient: IngestClient;

  constructor(private config: MoneymanConfig) {}

  init() {
    spanEvent("storage.initialize");
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

      spanEvent("storage.connect");
      this.ingestClient = new IngestClient(connection, ingestionProps);
    } catch (e) {
      trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR });
      trace
        .getActiveSpan()
        ?.recordException(e instanceof Error ? e : String(e));
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
    this.init();

    const stats = createSaveStats(
      "AzureDataExplorer",
      this.config.storage.azure?.tableName || "transactions",
      txns,
    );

    if (!this.ingestClient) {
      trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR });
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
        trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR });
        trace
          .getActiveSpan()
          ?.recordException(e instanceof Error ? e : String(e));
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
