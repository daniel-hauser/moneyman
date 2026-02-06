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
      const url = "https://api.example.com";
      const tokenString = "secret123";
      const encodedUrl = Buffer.from(url).toString("base64");
      const token = `${encodedUrl}.${tokenString}`;

      const storage = new MoneymanDashStorage(mockConfig(token));
      expect(storage.canSave()).toBe(true);
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
      const encodedUrl = Buffer.from(url).toString("base64");
      const token = `${encodedUrl}.${tokenString}`;

      const txns = [transactionRow({}), transactionRow({ account: "5678" })];
      const runId = randomUUID();

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "ing_123",
          added: 2,
          pending: 0,
          skipped: 0,
          status: "success",
        }),
      });

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

    it("should filter pending transactions", async () => {
      const url = "https://api.example.com";
      const tokenString = "secret123";
      const encodedUrl = Buffer.from(url).toString("base64");
      const token = `${encodedUrl}.${tokenString}`;

      const completedTx = transactionRow({
        status: TransactionStatuses.Completed,
      });
      const pendingTx = transactionRow({
        status: TransactionStatuses.Pending,
      });

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "ing_123",
          added: 1,
          pending: 1,
          skipped: 0,
          status: "success",
        }),
      });

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
      const url = "https://api.example.com";
      const tokenString = "secret123";
      const encodedUrl = Buffer.from(url).toString("base64");
      const token = `${encodedUrl}.${tokenString}`;

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
      const url = "https://api.example.com";
      const tokenString = "secret123";
      const encodedUrl = Buffer.from(url).toString("base64");
      const token = `${encodedUrl}.${tokenString}`;

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "ing_123",
          added: 1,
          pending: 0,
          skipped: 0,
          status: "success",
        }),
      });

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
      const url = "https://api.example.com";
      const tokenString = "secret123";
      const encodedUrl = Buffer.from(url).toString("base64");
      const token = `${encodedUrl}.${tokenString}`;

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "ing_123",
          added: 1,
          pending: 0,
          skipped: 0,
          status: "success",
        }),
      });

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
    it("should send logs with correct runId", async () => {
      const url = "https://api.example.com";
      const tokenString = "secret123";
      const encodedUrl = Buffer.from(url).toString("base64");
      const token = `${encodedUrl}.${tokenString}`;

      const storage = new MoneymanDashStorage(mockConfig(token));
      const logs = "2024-01-15 10:00:00 Starting scrape...";
      const runId = randomUUID();

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await new Promise((resolve) => {
        runContextStore.run({ runId }, async () => {
          await storage.sendLogs(logs);
          resolve(undefined);
        });
      });

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

    it("should skip logs if no runId in context", async () => {
      const url = "https://api.example.com";
      const tokenString = "secret123";
      const encodedUrl = Buffer.from(url).toString("base64");
      const token = `${encodedUrl}.${tokenString}`;

      const storage = new MoneymanDashStorage(mockConfig(token));

      // Call without runContext
      await storage.sendLogs("some logs");

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should handle log upload errors gracefully", async () => {
      const url = "https://api.example.com";
      const tokenString = "secret123";
      const encodedUrl = Buffer.from(url).toString("base64");
      const token = `${encodedUrl}.${tokenString}`;

      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const storage = new MoneymanDashStorage(mockConfig(token));

      // Should not throw, just log the error
      await new Promise((resolve) => {
        runContextStore.run({ runId: randomUUID() }, async () => {
          await storage.sendLogs("logs");
          resolve(undefined);
        });
      });
    });
  });

  describe("metadata calculation", () => {
    it("should calculate correct account count", async () => {
      const url = "https://api.example.com";
      const tokenString = "secret123";
      const encodedUrl = Buffer.from(url).toString("base64");
      const token = `${encodedUrl}.${tokenString}`;

      const txns = [
        transactionRow({ account: "1234" }),
        transactionRow({ account: "1234" }), // duplicate
        transactionRow({ account: "5678" }),
        transactionRow({ account: "9012" }),
      ];

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "ing_123",
          added: 4,
          pending: 0,
          skipped: 0,
          status: "success",
        }),
      });

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
      const url = "https://api.example.com";
      const tokenString = "secret123";
      const encodedUrl = Buffer.from(url).toString("base64");
      const token = `${encodedUrl}.${tokenString}`;

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "ing_123",
          added: 1,
          pending: 0,
          skipped: 0,
          status: "success",
        }),
      });

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
