import assert from "node:assert";
import { Pool, type PoolClient } from "pg";
import pgFormat from "pg-format";
import { format as formatDate, parseISO } from "date-fns";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { createLogger } from "../../utils/logger.js";
import { tableRow } from "../transactionTableRow.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { createSaveStats } from "../saveStats.js";
import { sendError } from "../notifier.js";
import type { MoneymanConfig } from "../../config.js";
import { normalizeCurrency } from "../../utils/currency.js";

const logger = createLogger("sql-storage");

const TRANSACTIONS_TABLE_NAME = "transactions";
const RAW_TABLE_NAME = "transactions_raw";

const TRANSACTION_COLUMNS = [
  "unique_id",
  "company_id",
  "account",
  "status",
  "activity_date",
  "charged_amount",
  "charged_currency",
  "original_amount",
  "original_currency",
  "description",
  "memo",
  "identifier",
  "installments",
  "raw",
] as const;

export class SqlStorage implements TransactionStorage {
  constructor(private readonly config: MoneymanConfig) {}

  canSave(): boolean {
    return Boolean(this.config.storage.sql?.connectionString);
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    assert(this.canSave(), "SQL storage configuration not found");

    if (!txns.length) {
      return createSaveStats("Postgres", undefined, txns);
    }

    const sqlConfig = this.config.storage.sql!;
    const schema = sqlConfig.schema ?? "moneyman";
    const stats = createSaveStats(
      "Postgres",
      `${schema}.${TRANSACTIONS_TABLE_NAME}`,
      txns,
    );

    const pool = new Pool({
      connectionString: sqlConfig.connectionString,
      max: 1,
    });
    const client = await pool.connect();
    try {
      await onProgress(`Ensuring schema ${schema}`);
      await this.ensureInitialized(client, schema);

      const nonPending = txns.filter(
        (tx) => tx.status !== TransactionStatuses.Pending,
      );

      await this.withTransaction(client, async (transactionClient) => {
        if (nonPending.length > 0) {
          await onProgress(`Upserting ${nonPending.length} transactions`);
          const { inserted, updated } = await this.upsertTransactions(
            transactionClient,
            nonPending,
            schema,
          );
          stats.added += inserted;
          stats.existing += updated;
        }
        await onProgress(`Recording ${txns.length} raw transactions`);
        await this.insertRawTransactions(transactionClient, txns, schema);
      });

      logger(`Saved ${txns.length} transactions`, stats);
    } catch (error) {
      logger("error saving transactions", error);
      await sendError(error, "SqlStorage::saveTransactions");
      throw error;
    } finally {
      await onProgress("Closing SQL client");
      client.release();
      try {
        await pool.end();
      } catch (e) {
        await onProgress("Error closing SQL client");
        logger("error closing SQL client", e);
      }
    }

    return stats;
  }

  private async withTransaction<T>(
    client: PoolClient,
    fn: (tx: PoolClient) => Promise<T>,
  ): Promise<T> {
    await client.query("BEGIN");
    logger("Starting transaction");
    try {
      const result = await fn(client);
      logger("Transaction completed successfully");
      await client.query("COMMIT");
      return result;
    } catch (error) {
      logger("Rolling back transaction due to error", error);
      await client.query("ROLLBACK");
      throw error;
    }
  }

  private async ensureInitialized(
    client: PoolClient,
    schema: string,
  ): Promise<void> {
    logger(`Ensuring schema ${schema} exists`);
    await client.query(pgFormat("CREATE SCHEMA IF NOT EXISTS %I", schema));
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${pgFormat(
        "%I.%I",
        schema,
        TRANSACTIONS_TABLE_NAME,
      )} (
        "unique_id" TEXT PRIMARY KEY,

        "company_id" TEXT NOT NULL,
        "account" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "activity_date" DATE NOT NULL,
        "charged_amount" NUMERIC NOT NULL,
        "charged_currency" TEXT,
        "original_amount" NUMERIC,
        "original_currency" TEXT,
        "description" TEXT,
        "memo" TEXT,
        "identifier" TEXT,
        "installments" JSONB,
        "raw" JSONB NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${pgFormat("%I.%I", schema, RAW_TABLE_NAME)} (
        "id" BIGSERIAL PRIMARY KEY,
        "raw" JSONB NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(
      pgFormat(
        `CREATE INDEX IF NOT EXISTS %I ON %s ("company_id", "account", "activity_date")`,
        `${TRANSACTIONS_TABLE_NAME}_company_account_date_idx`,
        pgFormat("%I.%I", schema, TRANSACTIONS_TABLE_NAME),
      ),
    );
  }

  private async upsertTransactions(
    client: PoolClient,
    txns: Array<TransactionRow>,
    schema: string,
  ): Promise<{ inserted: number; updated: number }> {
    if (txns.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    const uniqueIds = Array.from(new Set(txns.map((tx) => tx.uniqueId)));
    const existingRows = uniqueIds.length
      ? await client.query<{ unique_id: string }>(
          `SELECT "unique_id" FROM ${pgFormat(
            "%I.%I",
            schema,
            TRANSACTIONS_TABLE_NAME,
          )} WHERE "unique_id" IN (${uniqueIds
            .map((_, index) => `$${index + 1}`)
            .join(", ")})`,
          uniqueIds,
        )
      : { rows: [] };
    const existingIds = new Set(existingRows.rows.map((row) => row.unique_id));

    const insert = buildInsertStatement(
      schema,
      TRANSACTIONS_TABLE_NAME,
      [...TRANSACTION_COLUMNS],
      txns.map((tx) => toRow(tx)),
    );

    await client.query({
      text: `${insert.text}
      ON CONFLICT ("unique_id") DO UPDATE SET
        "company_id" = excluded."company_id",
        "account" = excluded."account",
        "status" = excluded."status",
        "activity_date" = excluded."activity_date",
        "charged_amount" = excluded."charged_amount",
        "charged_currency" = excluded."charged_currency",
        "original_amount" = excluded."original_amount",
        "original_currency" = excluded."original_currency",
        "description" = excluded."description",
        "memo" = excluded."memo",
        "identifier" = excluded."identifier",
        "installments" = excluded."installments",
        "raw" = excluded."raw",
        "updated_at" = now()`,
      values: insert.values,
    });

    const seen = new Set<string>();
    const updatedTxns = txns.filter((tx) => {
      if (existingIds.has(tx.uniqueId)) {
        seen.add(tx.uniqueId);
        return true;
      }
      if (seen.has(tx.uniqueId)) {
        return true;
      }
      seen.add(tx.uniqueId);
      return false;
    });

    const updated = updatedTxns.length;
    const inserted = txns.length - updated;

    return { inserted, updated };
  }

  private async insertRawTransactions(
    client: PoolClient,
    txns: Array<TransactionRow>,
    schema: string,
  ): Promise<void> {
    if (txns.length === 0) {
      return;
    }

    await client.query(
      buildInsertStatement(
        schema,
        RAW_TABLE_NAME,
        ["raw"],
        txns.map((tx) => toRow(tx)),
      ),
    );
  }
}

type TransactionColumnName = (typeof TRANSACTION_COLUMNS)[number];

function toRow(tx: TransactionRow) {
  const row = tableRow(tx, true);
  return {
    unique_id: tx.uniqueId,
    company_id: tx.companyId,
    account: row.account,
    status: tx.status,
    activity_date: formatDate(parseISO(tx.date), "yyyy-MM-dd"),
    charged_amount: row.amount,
    charged_currency: row.chargedCurrency ?? null,
    original_amount: tx.originalAmount ?? null,
    original_currency: normalizeCurrency(tx.originalCurrency) ?? null,
    description: row.description,
    memo: row.memo ?? null,
    identifier: row.identifier ?? null,
    installments:
      tx.installments === undefined || tx.installments === null
        ? null
        : JSON.stringify(tx.installments),
    raw: JSON.stringify(tx),
  } satisfies Record<TransactionColumnName, unknown>;
}

function buildInsertStatement<TColumns extends string[]>(
  schema: string,
  table: string,
  columns: TColumns,
  rows: Array<Record<TColumns[number], unknown>>,
) {
  const columnNames = columns.map((column) => pgFormat("%I", column));
  const values: Array<unknown> = [];

  const valueGroups = rows.map((row) => {
    const placeholders = columns.map((column) => {
      const index = values.push(row[column]);
      return `$${index}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const text = `INSERT INTO ${pgFormat("%I.%I", schema, table)} (${columnNames.join(", ")}) VALUES ${valueGroups.join(", ")}`;

  return { text, values };
}
