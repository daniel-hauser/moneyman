import { MoneymanDashStorage } from "./moneyman.js";
import { transactionRow, config } from "../../utils/tests.js";
import type { MoneymanConfig } from "../../config.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { runContextStore } from "../../utils/asyncContext.js";
import { randomUUID } from "crypto";

// Mock dependencies
jest.mock("../../utils/logger.js", () => ({
  createLogger: () => jest.fn(),
}));

const mockConfig = (token?: string): MoneymanConfig => {
  const cfg = config();
  if (token) {
    cfg.storage = { moneyman: { token } };
  }
  return cfg;
};

const makeToken = (url: string, tokenString: string) => {
  const encodedUrl = Buffer.from(url).toString("base64");
  return `${encodedUrl}.${tokenString}`;
};

const mockSuccessResponse = (overrides?: Record<string, unknown>) => ({
  ok: true,
  json: async () => ({
    id: "ing_123",
    added: 1,
    pending: 0,
    skipped: 0,
    status: "success",
    ...overrides,
  }),
});

describe("MoneymanDashStorage", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("token parsing", () => {
    it("should parse valid token format", () => {
      const token = makeToken("https://api.example.com", "secret123");
      const storage = new MoneymanDashStorage(mockConfig(token));
      expect(storage.canSave()).toBe(true);
    });

    it("should handle token string containing dots (JWT-style)", async () => {
      const url = "https://api.example.com";
      const jwtToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc";
      const token = makeToken(url, jwtToken);

      fetchMock.mockResolvedValue(mockSuccessResponse());

      const storage = new MoneymanDashStorage(mockConfig(token));

      await new Promise((resolve) => {
        runContextStore.run({ runId: randomUUID() }, async () => {
          await storage.saveTransactions([transactionRow({})], async () => {});
          resolve(undefined);
        });
      });

      // Verify the full JWT token (with dots) was used as bearer
      expect(fetchMock).toHaveBeenCalledWith(
        `${url}/api/ingest`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${jwtToken}`,
          }),
        })
      );
    });

    it("should return false when no token configured", () => {
      const storage = new MoneymanDashStorage(mockConfig());
      expect(storage.canSave()).toBe(false);
    });
  });

  describe("saveTransactions", () => {
    it("should send transactions with correct payload", async () => {
      const url = "https://api.example.com";
      const tokenString = "secret123";
      const token = makeToken(url, tokenString);

      const txns = [transactionRow({}), transactionRow({ account: "5678" })];
      const runId = randomUUID();

      fetchMock.mockResolvedValue(mockSuccessResponse({ added: 2 }));

      const storage = new MoneymanDashStorage(mockConfig(token));

      const stats = await new Promise((resolve) => {
        runContextStore.run({ runId }, async () => {
          const result = await storage.saveTransactions(txns, async () => {});
          resolve(result);
        });
      });

      expect(fetchMock).toHaveBeenCalledWith(
        `${url}/api/ingest`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${tokenString}`,
            "Content-Type": "application/json",
          }),
        })
      );

      const callArg = fetchMock.mock.calls[0][1];
      const body = JSON.parse(callArg.body);

      expect(body).toMatchObject({
        runId,
        metadata: expect.objectContaining({
          scrapedBy: "moneyman",
          accounts: 2,
          added: 2,
          pending: 0,
          skipped: 0,
          highlightedTransactions: 0,
        }),
        transactions: expect.arrayContaining([
          expect.objectContaining({
            account: "1234",
          }),
          expect.objectContaining({
            account: "5678",
          }),
        ]),
      });

      expect(stats).toMatchObject({
        added: 2,
        otherSkipped: 0,
      });
    });

    it("should only include expected fields in transaction payload", async () => {
      const token = makeToken("https://api.example.com", "secret123");

      fetchMock.mockResolvedValue(mockSuccessResponse());

      const storage = new MoneymanDashStorage(mockConfig(token));

      await new Promise((resolve) => {
        runContextStore.run({ runId: randomUUID() }, async () => {
          await storage.saveTransactions([transactionRow({})], async () => {});
          resolve(undefined);
        });
      });

      const callArg = fetchMock.mock.calls[0][1];
      const body = JSON.parse(callArg.body);
      const txn = body.transactions[0];

      const expectedKeys = [
        "account", "companyId", "hash", "uniqueId", "date",
        "description", "memo", "originalAmount", "originalCurrency",
        "chargedAmount", "chargedCurrency", "type", "status", "category",
      ];

      // Should not contain extra fields like processedDate, identifier, etc.
      for (const key of Object.keys(txn)) {
        expect(expectedKeys).toContain(key);
      }
    });

    it("should filter pending transactions", async () => {
      const token = makeToken("https://api.example.com", "secret123");

      const completedTx = transactionRow({
        status: TransactionStatuses.Completed,
      });
      const pendingTx = transactionRow({
        status: TransactionStatuses.Pending,
      });

      fetchMock.mockResolvedValue(mockSuccessResponse({ added: 1, pending: 1 }));

      const storage = new MoneymanDashStorage(mockConfig(token));

      await new Promise((resolve) => {
        runContextStore.run({ runId: randomUUID() }, async () => {
          await storage.saveTransactions(
            [completedTx, pendingTx],
            async () => {}
          );
          resolve(undefined);
        });
      });

      const callArg = fetchMock.mock.calls[0][1];
      const body = JSON.parse(callArg.body);

      expect(body.transactions).toHaveLength(1);
      expect(body.transactions[0].status).toBe(TransactionStatuses.Completed);
    });

    it("should handle API errors", async () => {
      const token = makeToken("https://api.example.com", "secret123");

      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const storage = new MoneymanDashStorage(mockConfig(token));

      await expect(
        new Promise((resolve, reject) => {
          runContextStore.run({ runId: randomUUID() }, async () => {
            try {
              await storage.saveTransactions(
                [transactionRow({})],
                async () => {}
              );
              resolve(undefined);
            } catch (e) {
              reject(e);
            }
          });
        })
      ).rejects.toThrow("Failed to post transactions");
    });

    it("should call onProgress callback", async () => {
      const token = makeToken("https://api.example.com", "secret123");

      fetchMock.mockResolvedValue(mockSuccessResponse());

      const storage = new MoneymanDashStorage(mockConfig(token));
      const onProgress = jest.fn();

      await new Promise((resolve) => {
        runContextStore.run({ runId: randomUUID() }, async () => {
          await storage.saveTransactions([transactionRow({})], onProgress);
          resolve(undefined);
        });
      });

      expect(onProgress).toHaveBeenCalledWith("Sending transactions");
    });

    it("should handle missing runId gracefully", async () => {
      const token = makeToken("https://api.example.com", "secret123");

      fetchMock.mockResolvedValue(mockSuccessResponse());

      const storage = new MoneymanDashStorage(mockConfig(token));

      // Call without runContext
      await storage.saveTransactions([transactionRow({})], async () => {});

      const callArg = fetchMock.mock.calls[0][1];
      const body = JSON.parse(callArg.body);

      // Should not include runId if not in context
      expect(body.runId).toBeUndefined();
    });
  });

  describe("sendLogs", () => {
    it("should send logs using lastRunId from saveTransactions", async () => {
      const url = "https://api.example.com";
      const tokenString = "secret123";
      const token = makeToken(url, tokenString);

      const storage = new MoneymanDashStorage(mockConfig(token));
      const logs = "2024-01-15 10:00:00 Starting scrape...";
      const runId = randomUUID();

      fetchMock.mockResolvedValue(mockSuccessResponse());

      // First, call saveTransactions within runContext to store runId
      await new Promise((resolve) => {
        runContextStore.run({ runId }, async () => {
          await storage.saveTransactions([transactionRow({})], async () => {});
          resolve(undefined);
        });
      });

      fetchMock.mockClear();
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

      // Now call sendLogs OUTSIDE runContext (like sendAndDeleteLogFile does)
      await storage.sendLogs(logs);

      expect(fetchMock).toHaveBeenCalledWith(
        `${url}/api/ingest/logs`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${tokenString}`,
          }),
        })
      );

      const formData = fetchMock.mock.calls[0][1].body;
      expect(formData).toBeInstanceOf(FormData);
    });

    it("should skip logs if no token parsed", async () => {
      const storage = new MoneymanDashStorage(mockConfig());

      await storage.sendLogs("some logs");

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should skip logs if no runId ever stored", async () => {
      const token = makeToken("https://api.example.com", "secret123");
      const storage = new MoneymanDashStorage(mockConfig(token));

      // Call without ever calling saveTransactions or being in runContext
      await storage.sendLogs("some logs");

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should handle log upload errors gracefully", async () => {
      const token = makeToken("https://api.example.com", "secret123");

      // First save to populate lastRunId
      fetchMock.mockResolvedValue(mockSuccessResponse());
      const storage = new MoneymanDashStorage(mockConfig(token));

      await new Promise((resolve) => {
        runContextStore.run({ runId: randomUUID() }, async () => {
          await storage.saveTransactions([transactionRow({})], async () => {});
          resolve(undefined);
        });
      });

      // Now fail the logs upload
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      // Should not throw, just log the error
      await storage.sendLogs("logs");
    });
  });

  describe("metadata calculation", () => {
    it("should calculate correct account count", async () => {
      const token = makeToken("https://api.example.com", "secret123");

      const txns = [
        transactionRow({ account: "1234" }),
        transactionRow({ account: "1234" }), // duplicate
        transactionRow({ account: "5678" }),
        transactionRow({ account: "9012" }),
      ];

      fetchMock.mockResolvedValue(mockSuccessResponse({ added: 4 }));

      const storage = new MoneymanDashStorage(mockConfig(token));

      await new Promise((resolve) => {
        runContextStore.run({ runId: randomUUID() }, async () => {
          await storage.saveTransactions(txns, async () => {});
          resolve(undefined);
        });
      });

      const callArg = fetchMock.mock.calls[0][1];
      const body = JSON.parse(callArg.body);

      expect(body.metadata.accounts).toBe(3); // unique accounts
    });

    it("should include proper ISO timestamp", async () => {
      const token = makeToken("https://api.example.com", "secret123");

      fetchMock.mockResolvedValue(mockSuccessResponse());

      const storage = new MoneymanDashStorage(mockConfig(token));

      await new Promise((resolve) => {
        runContextStore.run({ runId: randomUUID() }, async () => {
          await storage.saveTransactions([transactionRow({})], async () => {});
          resolve(undefined);
        });
      });

      const callArg = fetchMock.mock.calls[0][1];
      const body = JSON.parse(callArg.body);

      expect(body.metadata.scrapedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
    });
  });
});
