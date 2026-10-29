import { Context, Telegram, Telegraf } from "telegraf";
import {
  CommandHandlers,
  HELP_MESSAGE,
  formatStatus,
  registerCommands,
} from "./commands.js";
import { createBot, isAuthorizedChat } from "./bot.js";

jest.mock("../config.js", () => ({
  config: {
    options: { notifications: { telegram: { chatId: "555" } } },
  },
}));

const chatId = 555;

function createContext(id: number) {
  return { chat: { id } } as unknown as Context;
}

function createHandlers(overrides: Partial<CommandHandlers> = {}) {
  return {
    scrape: jest.fn().mockResolvedValue("🔄 Starting a scrape now..."),
    isRunning: jest.fn().mockResolvedValue(false),
    getLastRun: jest.fn().mockReturnValue(undefined),
    getNextRunAt: jest.fn().mockReturnValue(undefined),
    ...overrides,
  } satisfies CommandHandlers;
}

function registerBot(handlers: CommandHandlers) {
  const bot = new Telegraf("123:token");
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: "moneyman",
    username: "moneyman_bot",
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };
  // Telegraf creates a new Telegram client for each update
  const callApi = jest
    .spyOn(Telegram.prototype, "callApi")
    .mockResolvedValue(true as never);

  createBot(bot);
  registerCommands(bot, handlers);

  async function send(text: string, fromChat = chatId) {
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: fromChat, type: "private", first_name: "user" },
        from: { id: fromChat, is_bot: false, first_name: "user" },
        text,
        entities: [{ type: "bot_command", offset: 0, length: text.length }],
      },
    });
  }

  const replies = () =>
    callApi.mock.calls
      .filter(([method]) => method === "sendMessage")
      .map(([, payload]) => (payload as { text: string }).text);

  return { send, replies, callApi };
}

describe("commands", () => {
  afterEach(() => jest.restoreAllMocks());
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
    it("reports an idle process without history", async () => {
      const status = await formatStatus({
        isRunning: async () => false,
        getLastRun: () => undefined,
        getNextRunAt: () => undefined,
      });

      expect(status).toContain("😴 Idle");
      expect(status).toContain("No run finished in this process yet");
      expect(status).toContain("No scheduled run configured");
    });

    it("reports a running scrape", async () => {
      const status = await formatStatus({
        isRunning: async () => true,
        getLastRun: () => undefined,
        getNextRunAt: () => new Date("2026-03-01T21:00:00"),
      });

      expect(status).toContain("🔄 A scrape is running right now");
      expect(status).toContain("Next scheduled run at");
    });

    it("summarizes the last run", async () => {
      const status = await formatStatus({
        isRunning: async () => false,
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
    it("registers the command menu", () => {
      const { callApi } = registerBot(createHandlers());

      expect(callApi).toHaveBeenCalledWith(
        "setMyCommands",
        expect.objectContaining({
          commands: expect.arrayContaining([
            { command: "scrape", description: expect.any(String) },
          ]),
        }),
      );
    });

    it.each(["/scrape", "/fetch"])(
      "runs a scrape for %s and replies",
      async (command) => {
        const handlers = createHandlers();
        const { send, replies } = registerBot(handlers);

        await send(command);

        expect(handlers.scrape).toHaveBeenCalledTimes(1);
        expect(replies()).toEqual(["🔄 Starting a scrape now..."]);
      },
    );

    it("ignores commands from other chats", async () => {
      const handlers = createHandlers();
      const { send, replies } = registerBot(handlers);

      await send("/scrape", 999);
      await send("/status", 999);
      await send("/help", 999);

      expect(handlers.scrape).not.toHaveBeenCalled();
      expect(replies()).toEqual([]);
    });

    it("replies with the help message", async () => {
      const { send, replies } = registerBot(createHandlers());

      await send("/help");

      expect(replies()).toEqual([HELP_MESSAGE]);
    });

    it("awaits the running state for /status", async () => {
      const { send, replies } = registerBot(
        createHandlers({ isRunning: jest.fn().mockResolvedValue(true) }),
      );

      await send("/status");

      expect(replies()[0]).toContain("🔄 A scrape is running right now");
    });

    it("reports a failure instead of throwing", async () => {
      const { send, replies } = registerBot(
        createHandlers({
          scrape: jest.fn().mockRejectedValue(new Error("boom")),
        }),
      );

      await send("/scrape");

      expect(replies()).toEqual(["❌ Failed to handle the command"]);
    });
  });
});
