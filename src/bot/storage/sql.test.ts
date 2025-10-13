jest.mock("../notifier.js", () => ({
  __esModule: true,
  sendError: jest.fn(),
}));

const PoolMock = jest.fn<
  void,
  ConstructorParameters<typeof import("pg").Pool>
>();

jest.mock("pg", () => ({
  __esModule: true,
  Pool: PoolMock,
}));

import { newDb, type IMemoryDb } from "pg-mem";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { SqlStorage } from "./sql.js";
import { config, transactionRow } from "../../utils/tests.js";

const onProgress = jest
  .fn<Promise<void>, [string]>()
  .mockResolvedValue(undefined);

describe("SqlStorage", () => {
  let storage: SqlStorage;
  let db: IMemoryDb;

  beforeEach(() => {
    jest.clearAllMocks();

    db = newDb({ noAstCoverageCheck: true });
    PoolMock.mockImplementation(() => new (db.adapters.createPg().Pool)());

    const mockConfig = config();
    mockConfig.storage.sql = {
      connectionString: "postgresql://user:pass@localhost:5432/moneyman",
      schema: "moneyman",
    };
    storage = new SqlStorage(mockConfig);
  });

  it("creates schema and inserts completed transactions", async () => {
    const tx = transactionRow({});

    const stats = await storage.saveTransactions([tx], onProgress);

    expect(stats.added).toBe(1);
    expect(stats.existing).toBe(0);

    const schema = db.getSchema("moneyman");
    expect(schema).toBeDefined();

    const rows = db.public.many(
      `SELECT "unique_id", "description", "raw"->>'hash' AS raw_hash
       FROM "moneyman"."transactions"`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      unique_id: tx.uniqueId,
      description: tx.description,
      raw_hash: tx.hash,
    });

    const rawRows = db.public.many(
      `SELECT "raw"->>'uniqueId' AS unique_id, "raw"->>'hash' AS raw_hash, "raw"->>'description' AS raw_description
       FROM "moneyman"."transactions_raw"`,
    );
    expect(rawRows).toHaveLength(1);
    expect(rawRows[0]).toMatchObject({
      unique_id: tx.uniqueId,
      raw_hash: tx.hash,
      raw_description: tx.description,
    });
  });

  it("upserts existing transactions and appends to raw log", async () => {
    const tx = transactionRow({});

    await storage.saveTransactions([tx], onProgress);

    const existing = db.public.one(
      `SELECT "unique_id" FROM "moneyman"."transactions" WHERE "unique_id" = '${tx.uniqueId}'`,
    ) as { unique_id: string };
    expect(existing.unique_id).toBe(tx.uniqueId);

    const updated = transactionRow({
      ...tx,
      description: "Updated description",
      memo: "Updated memo",
    });

    const stats = await storage.saveTransactions([updated], onProgress);

    expect(stats.added).toBe(0);
    expect(stats.existing).toBe(1);

    const stored = db.public.one(
      `SELECT "description", "memo" FROM "moneyman"."transactions" WHERE "unique_id" = '${updated.uniqueId}'`,
    ) as {
      description: string;
      memo: string | null;
    };
    expect(stored).toMatchObject({
      description: "Updated description",
      memo: "Updated memo",
    });

    const rawCount = db.public.one(
      `SELECT COUNT(*)::int AS count FROM "moneyman"."transactions_raw" WHERE "raw"->>'uniqueId' = '${updated.uniqueId}'`,
    ) as { count: number };
    expect(rawCount.count).toBe(2);
  });

  it("skips pending transactions from main table but records them in raw log", async () => {
    const pending = transactionRow({
      status: TransactionStatuses.Pending,
    });

    const stats = await storage.saveTransactions([pending], onProgress);

    expect(stats.added).toBe(0);
    expect(stats.existing).toBe(0);
    expect(stats.pending).toBe(1);

    const storedRows = db.public.many(
      `SELECT * FROM "moneyman"."transactions" WHERE "unique_id" = '${pending.uniqueId}'`,
    );
    expect(storedRows).toHaveLength(0);

    const rawStored = db.public.one(
      `SELECT "raw"->>'status' AS status FROM "moneyman"."transactions_raw" WHERE "raw"->>'uniqueId' = '${pending.uniqueId}'`,
    ) as { status: TransactionStatuses };
    expect(rawStored.status).toBe(TransactionStatuses.Pending);
  });

  it("counts duplicate unique IDs within a single batch as updates", async () => {
    const first = transactionRow({
      uniqueId: "duplicate-1",
      hash: "hash-initial",
      description: "Initial description",
      memo: "Initial memo",
    });
    const duplicate = transactionRow({
      uniqueId: "duplicate-1",
      hash: "hash-updated",
      description: "Updated description",
      memo: "Updated memo",
    });

    const stats = await storage.saveTransactions(
      [first, duplicate],
      onProgress,
    );

    expect(stats.added).toBe(1);
    expect(stats.existing).toBe(1);
    expect(stats.pending).toBe(0);

    const stored = db.public.one(
      `SELECT "description", "memo", "raw"->>'hash' AS raw_hash FROM "moneyman"."transactions" WHERE "unique_id" = 'duplicate-1'`,
    ) as { raw_hash: string; description: string; memo: string | null };
    expect(stored).toMatchObject({
      description: "Updated description",
      memo: "Updated memo",
      raw_hash: "hash-updated",
    });

    const rawRows = db.public.many(
      `SELECT "raw"->>'hash' AS hash FROM "moneyman"."transactions_raw" WHERE "raw"->>'uniqueId' = 'duplicate-1' ORDER BY "id"`,
    );
    expect(rawRows).toHaveLength(2);
    expect(rawRows.map((row) => row.hash)).toEqual([
      "hash-initial",
      "hash-updated",
    ]);
  });

  it("mixes new and existing transactions in one batch", async () => {
    const existing = transactionRow({
      uniqueId: "existing-1",
      hash: "hash-existing",
      description: "Existing description",
    });
    await storage.saveTransactions([existing], onProgress);

    const updatedExisting = transactionRow({
      uniqueId: "existing-1",
      hash: "hash-existing-updated",
      description: "Updated existing",
    });
    const newlyInserted = transactionRow({
      uniqueId: "existing-2",
      hash: "hash-new",
      description: "Brand new",
    });

    const stats = await storage.saveTransactions(
      [updatedExisting, newlyInserted],
      onProgress,
    );

    expect(stats.added).toBe(1);
    expect(stats.existing).toBe(1);
    expect(stats.pending).toBe(0);

    const rows = db.public.many(
      `SELECT "unique_id", "description", "raw"->>'hash' AS raw_hash FROM "moneyman"."transactions" WHERE "unique_id" IN ('existing-1', 'existing-2') ORDER BY "unique_id"`,
    );
    expect(rows).toEqual([
      {
        unique_id: "existing-1",
        description: "Updated existing",
        raw_hash: "hash-existing-updated",
      },
      {
        unique_id: "existing-2",
        description: "Brand new",
        raw_hash: "hash-new",
      },
    ]);

    const rawCounts = db.public.many(
      `SELECT "raw"->>'uniqueId' AS unique_id, COUNT(*)::int AS count FROM "moneyman"."transactions_raw" WHERE "raw"->>'uniqueId' IN ('existing-1', 'existing-2') GROUP BY "raw"->>'uniqueId' ORDER BY "raw"->>'uniqueId'`,
    );
    expect(rawCounts).toEqual([
      { unique_id: "existing-1", count: 2 },
      { unique_id: "existing-2", count: 1 },
    ]);
  });
});
