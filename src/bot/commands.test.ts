import { Context, Telegraf } from "telegraf";
import {
  CommandHandlers,
  HELP_MESSAGE,
  formatStatus,
  isAuthorizedChat,
  registerCommands,
} from "./commands.js";

jest.mock("../config.js", () => ({
  config: {
    options: { notifications: { telegram: { chatId: "555" } } },
  },
}));

type Handler = (ctx: Context) => Promise<void>;

const chatId = 555;

function createContext(id: number) {
  return {
    chat: { id },
    reply: jest.fn().mockResolvedValue(undefined),
  } as unknown as Context & { reply: jest.Mock };
}

function createHandlers(overrides: Partial<CommandHandlers> = {}) {
  return {
    scrape: jest.fn().mockResolvedValue("🔄 Starting a scrape now..."),
    isRunning: jest.fn().mockReturnValue(false),
    getLastRun: jest.fn().mockReturnValue(undefined),
    getNextRunAt: jest.fn().mockReturnValue(undefined),
    ...overrides,
  } satisfies CommandHandlers;
}

function registerBot(handlers: CommandHandlers) {
  const registered = new Map<string, Handler>();
  const bot = {
    catch: jest.fn(),
    command: (name: string, handler: Handler) => {
      registered.set(name, handler);
      return bot;
    },
    telegram: { setMyCommands: jest.fn().mockResolvedValue(undefined) },
  } as unknown as Telegraf<Context>;

  registerCommands(bot, handlers);

  return { registered, bot };
}

describe("commands", () => {
  describe("isAuthorizedChat", () => {
    it("accepts the configured chat", () => {
      expect(isAuthorizedChat(createContext(chatId))).toBe(true);
    });

    it("rejects any other chat", () => {
      expect(isAuthorizedChat(createContext(999))).toBe(false);
      expect(isAuthorizedChat({ chat: undefined } as unknown as Context)).toBe(
        false,
      );
    });
  });

  describe("formatStatus", () => {
    it("reports an idle process without history", () => {
      const status = formatStatus({
        isRunning: () => false,
        getLastRun: () => undefined,
        getNextRunAt: () => undefined,
      });

      expect(status).toContain("😴 Idle");
      expect(status).toContain("No run finished in this process yet");
      expect(status).toContain("No scheduled run configured");
    });

    it("reports a running scrape", () => {
      const status = formatStatus({
        isRunning: () => true,
        getLastRun: () => undefined,
        getNextRunAt: () => new Date("2026-03-01T21:00:00"),
      });

      expect(status).toContain("🔄 A scrape is running right now");
      expect(status).toContain("Next scheduled run at");
    });

    it("summarizes the last run", () => {
      const status = formatStatus({
        isRunning: () => false,
        getLastRun: () => ({
          trigger: "manual",
          startedAt: new Date("2026-03-01T09:00:00"),
          endedAt: new Date("2026-03-01T09:02:00"),
          failed: true,
        }),
        getNextRunAt: () => undefined,
      });

      expect(status).toContain("❌ Last run (manual)");
      expect(status).toContain("took 120s");
    });
  });

  describe("registerCommands", () => {
    it("registers the scrape aliases, status, help and the menu", () => {
      const { registered, bot } = registerBot(createHandlers());

      expect([...registered.keys()].sort()).toEqual([
        "fetch",
        "help",
        "scrape",
        "status",
      ]);
      expect(bot.telegram.setMyCommands).toHaveBeenCalledWith(
        expect.arrayContaining([
          { command: "scrape", description: expect.any(String) },
        ]),
      );
    });

    it("runs a scrape and replies with the result", async () => {
      const handlers = createHandlers();
      const { registered } = registerBot(handlers);
      const ctx = createContext(chatId);

      await registered.get("scrape")!(ctx);

      expect(handlers.scrape).toHaveBeenCalledTimes(1);
      expect(ctx.reply).toHaveBeenCalledWith("🔄 Starting a scrape now...");
    });

    it("runs a scrape from the fetch alias too", async () => {
      const handlers = createHandlers();
      const { registered } = registerBot(handlers);
      const ctx = createContext(chatId);

      await registered.get("fetch")!(ctx);

      expect(handlers.scrape).toHaveBeenCalledTimes(1);
    });

    it("ignores commands from other chats", async () => {
      const handlers = createHandlers();
      const { registered } = registerBot(handlers);
      const ctx = createContext(999);

      await registered.get("scrape")!(ctx);
      await registered.get("status")!(ctx);
      await registered.get("help")!(ctx);

      expect(handlers.scrape).not.toHaveBeenCalled();
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it("replies with the help message", async () => {
      const { registered } = registerBot(createHandlers());
      const ctx = createContext(chatId);

      await registered.get("help")!(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(HELP_MESSAGE);
    });

    it("reports a failure instead of throwing", async () => {
      const handlers = createHandlers({
        scrape: jest.fn().mockRejectedValue(new Error("boom")),
      });
      const { registered } = registerBot(handlers);
      const ctx = createContext(chatId);

      await registered.get("scrape")!(ctx);

      expect(ctx.reply).toHaveBeenCalledWith("❌ Failed to handle /scrape");
    });
  });
});
