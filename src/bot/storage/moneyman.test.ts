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

const makeMmToken = (url: string, secret: string) => {
  const payload = JSON.stringify({ u: url, k: secret });
  const b64 = Buffer.from(payload)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `mm_${b64}`;
};

const mockSuccessResponse = (overrides?: Record<string, unknown>) => ({
  ok: true,
  json: async () => ({
    success: true,
    transactionsAdded: 1,
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
    it("should parse valid legacy token format", () => {
      const token = makeToken("https://api.example.com", "secret123");
      const storage = new MoneymanDashStorage(mockConfig(token));
      expect(storage.canSave()).toBe(true);
    });

    it("should parse mm_ token format", async () => {
      const url = "https://api.example.com/ingest";
      const secret = "abc123secret";
      const token = makeMmToken(url, secret);

      fetchMock.mockResolvedValue(mockSuccessResponse());

      const storage = new MoneymanDashStorage(mockConfig(token));
      expect(storage.canSave()).toBe(true);

      await new Promise((resolve) => {
        runContextStore.run({ runId: randomUUID() }, async () => {
          await storage.saveTransactions([transactionRow({})], async () => {});
          resolve(undefined);
        });
      });

      expect(fetchMock).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${secret}`,
          }),
        }),
      );
    });

    it("should handle mm_ token with missing fields gracefully", () => {
      // Token with only URL, no secret — parseToken throws, constructor catches
      const base64 = Buffer.from(
        JSON.stringify({ u: "https://example.com" }),
      ).toString("base64url");
      const token = `mm_${base64}`;

      // Should not throw (constructor catches), but canSave() returns false
      const storage = new MoneymanDashStorage(mockConfig(token));
      expect(storage.canSave()).toBe(false);
    });

    it("should handle token string containing dots (JWT-style)", async () => {
      const url = "https://api.example.com/ingest";
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
        url,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${jwtToken}`,
          }),
        }),
      );
    });

    it("should return false when no token configured", () => {
      const storage = new MoneymanDashStorage(mockConfig());
      expect(storage.canSave()).toBe(false);
    });

    it("should reject non-http(s) URLs", () => {
      const token = makeMmToken("file:///etc/passwd", "secret");
      const storage = new MoneymanDashStorage(mockConfig(token));
      expect(storage.canSave()).toBe(false);
    });

    it("should reject invalid URLs", () => {
      const token = makeMmToken("not-a-url", "secret");
      const storage = new MoneymanDashStorage(mockConfig(token));
      expect(storage.canSave()).toBe(false);
    });

    it("should not be vulnerable to prototype pollution", () => {
      const malicious = Buffer.from(
        JSON.stringify({
          u: "https://example.com/ingest",
          k: "secret",
          __proto__: { polluted: true },
        }),
      ).toString("base64url");
      const token = `mm_${malicious}`;
      const storage = new MoneymanDashStorage(mockConfig(token));
      expect(storage.canSave()).toBe(true);
      expect((storage as any).polluted).toBeUndefined();
      expect(({} as any).polluted).toBeUndefined();
    });
  });

  describe("saveTransactions", () => {
    it("should send transactions with correct payload", async () => {
      const url = "https://api.example.com/ingest";
      const tokenString = "secret123";
      const token = makeToken(url, tokenString);

      const txns = [transactionRow({}), transactionRow({ account: "5678" })];
      const runId = randomUUID();

      fetchMock.mockResolvedValue(
        mockSuccessResponse({ transactionsAdded: 2 }),
      );

      const storage = new MoneymanDashStorage(mockConfig(token));

      const stats = await new Promise((resolve) => {
        runContextStore.run({ runId }, async () => {
          const result = await storage.saveTransactions(txns, async () => {});
          resolve(result);
        });
      });

      expect(fetchMock).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${tokenString}`,
            "Content-Type": "application/json",
          }),
        }),
      );

      const callArg = fetchMock.mock.calls[0][1];
      const body = JSON.parse(callArg.body);

      expect(body).toMatchObject({
        metadata: expect.objectContaining({
          scrapedBy: "moneyman",
          accounts: 2,
          added: 2,
          pending: 0,
          skipped: 0,
          highlightedTransactions: 0,
          runId,
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
      });
    });

    it("should send full transaction objects including raw fields", async () => {
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

      // Should include core fields
      expect(txn).toHaveProperty("account");
      expect(txn).toHaveProperty("companyId");
      expect(txn).toHaveProperty("hash");
      expect(txn).toHaveProperty("date");
      expect(txn).toHaveProperty("description");
      // Should include raw scraper fields (not stripped)
      expect(txn).toHaveProperty("processedDate");
    });

    it("should filter pending transactions", async () => {
      const token = makeToken("https://api.example.com", "secret123");

      const completedTx = transactionRow({
        status: TransactionStatuses.Completed,
      });
      const pendingTx = transactionRow({
        status: TransactionStatuses.Pending,
      });

      fetchMock.mockResolvedValue(
        mockSuccessResponse({ transactionsAdded: 1 }),
      );

      const storage = new MoneymanDashStorage(mockConfig(token));

      await new Promise((resolve) => {
        runContextStore.run({ runId: randomUUID() }, async () => {
          await storage.saveTransactions(
            [completedTx, pendingTx],
            async () => {},
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
                async () => {},
              );
              resolve(undefined);
            } catch (e) {
              reject(e);
            }
          });
        }),
      ).rejects.toThrow("Failed to post transactions");
    });

    it("should throw on unexpected response shape", async () => {
      const token = makeToken("https://api.example.com", "secret123");

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ error: "quota exceeded" }),
      });

      const storage = new MoneymanDashStorage(mockConfig(token));

      await expect(
        new Promise((resolve, reject) => {
          runContextStore.run({ runId: randomUUID() }, async () => {
            try {
              await storage.saveTransactions(
                [transactionRow({})],
                async () => {},
              );
              resolve(undefined);
            } catch (e) {
              reject(e);
            }
          });
        }),
      ).rejects.toThrow("Unexpected ingestion response shape");
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
      expect(body.metadata.runId).toBeUndefined();
    });
  });

  describe("sendLogs", () => {
    it("should send logs using lastRunId from saveTransactions", async () => {
      const url = "https://api.example.com/ingest";
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
        "https://api.example.com/ingest/logs",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${tokenString}`,
            "Content-Type": "text/plain",
            "X-Run-Id": runId,
          }),
          body: logs,
        }),
      );
    });

    it("should derive /ingest/logs URL from mm_ token's /ingest URL", async () => {
      const ingestUrl = "https://myapp.example.com/ingest";
      const secret = "my-secret";
      const token = makeMmToken(ingestUrl, secret);

      const storage = new MoneymanDashStorage(mockConfig(token));
      const runId = randomUUID();

      fetchMock.mockResolvedValue(mockSuccessResponse());

      await new Promise((resolve) => {
        runContextStore.run({ runId }, async () => {
          await storage.saveTransactions([transactionRow({})], async () => {});
          resolve(undefined);
        });
      });

      fetchMock.mockClear();
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

      await storage.sendLogs("test logs");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://myapp.example.com/ingest/logs",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${secret}`,
            "X-Run-Id": runId,
          }),
          body: "test logs",
        }),
      );
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
      const token = makeToken("https://api.example.com/ingest", "secret123");

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

      fetchMock.mockResolvedValue(
        mockSuccessResponse({ transactionsAdded: 4 }),
      );

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
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });
  });
});
