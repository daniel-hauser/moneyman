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
      `SELECT unique_id, description, raw->>'hash' AS raw_hash
       FROM moneyman.transactions`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      unique_id: tx.uniqueId,
      description: tx.description,
      raw_hash: tx.hash,
    });

    const rawRows = db.public.many(
      `SELECT unique_id, raw->>'hash' AS raw_hash, raw->>'description' AS raw_description
       FROM moneyman.transactions_raw`,
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
      `SELECT unique_id FROM moneyman.transactions WHERE unique_id = '${tx.uniqueId}'`,
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
      `SELECT description, memo FROM moneyman.transactions WHERE unique_id = '${updated.uniqueId}'`,
    ) as {
      description: string;
      memo: string | null;
    };
    expect(stored).toMatchObject({
      description: "Updated description",
      memo: "Updated memo",
    });

    const rawCount = db.public.one(
      `SELECT COUNT(*)::int AS count FROM moneyman.transactions_raw WHERE unique_id = '${updated.uniqueId}'`,
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
      `SELECT * FROM moneyman.transactions WHERE unique_id = '${pending.uniqueId}'`,
    );
    expect(storedRows).toHaveLength(0);

    const rawStored = db.public.one(
      `SELECT status FROM moneyman.transactions_raw WHERE unique_id = '${pending.uniqueId}'`,
    ) as { status: TransactionStatuses };
    expect(rawStored.status).toBe(TransactionStatuses.Pending);
  });
});
