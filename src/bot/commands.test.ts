import { Context, Telegram, Telegraf } from "telegraf";
import {
  CommandHandlers,
  disambiguateLabels,
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
    refreshSecrets: jest.fn().mockResolvedValue("Secrets refreshed"),
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

  async function tap(data: string, fromChat = chatId) {
    await bot.handleUpdate({
      update_id: 2,
      callback_query: {
        id: "callback",
        chat_instance: "chat-instance",
        from: { id: fromChat, is_bot: false, first_name: "user" },
        data,
        message: {
          message_id: 7,
          date: 0,
          chat: { id: fromChat, type: "private", first_name: "user" },
          from: { id: 1, is_bot: true, first_name: "moneyman" },
          text: "Pick a provider/account to scrape:",
        },
      },
    });
  }

  const replies = () =>
    callApi.mock.calls
      .filter(([method]) => method === "sendMessage")
      .map(([, payload]) => (payload as { text: string }).text);

  const replyMarkups = () =>
    callApi.mock.calls
      .filter(([method]) => method === "sendMessage")
      .map(
        ([, payload]) =>
          (payload as { reply_markup?: unknown }).reply_markup as
            | {
                inline_keyboard: Array<
                  Array<{ text: string; callback_data: string }>
                >;
              }
            | undefined,
      );

  const edits = () =>
    callApi.mock.calls
      .filter(([method]) => method === "editMessageText")
      .map(
        ([, payload]) =>
          payload as {
            text: string;
            reply_markup?: { inline_keyboard: Array<unknown> };
          },
      );

  return { send, tap, replies, replyMarkups, edits, callApi };
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
            { command: "refresh_secrets", description: expect.any(String) },
          ]),
        }),
      );
    });

    it("omits refresh from registration, the menu and help without a provider", async () => {
      const { send, replies, callApi } = registerBot(
        createHandlers({ refreshSecrets: undefined }),
      );

      expect(callApi).toHaveBeenCalledWith(
        "setMyCommands",
        expect.objectContaining({
          commands: expect.not.arrayContaining([
            { command: "refresh_secrets", description: expect.any(String) },
          ]),
        }),
      );
      await send("/refresh_secrets");
      expect(replies()).toEqual([]);
      await send("/help");
      expect(replies()).toHaveLength(1);
      expect(replies()[0]).toContain("/scrape");
      expect(replies()[0]).not.toContain("/refresh_secrets");
    });

    it.each(["/scrape", "/fetch"])(
      "runs a scrape for %s and replies",
      async (command) => {
        const handlers = createHandlers();
        const { send, replies } = registerBot(handlers);

        await send(command);

        expect(handlers.scrape).toHaveBeenCalledTimes(1);
        // No selection: every configured account is scraped
        expect(handlers.scrape).toHaveBeenCalledWith();
        expect(replies()).toEqual(["🔄 Starting a scrape now..."]);
      },
    );

    it("ignores commands from other chats", async () => {
      const handlers = createHandlers();
      const { send, replies } = registerBot(handlers);

      await send("/scrape", 999);
      await send("/status", 999);
      await send("/help", 999);
      await send("/refresh_secrets", 999);

      expect(handlers.scrape).not.toHaveBeenCalled();
      expect(handlers.refreshSecrets).not.toHaveBeenCalled();
      expect(replies()).toEqual([]);
    });

    it("replies with the help message", async () => {
      const { send, replies } = registerBot(createHandlers());

      await send("/help");

      expect(replies()).toHaveLength(1);
      expect(replies()[0]).toContain(
        "Moneyman is running and listening for commands:",
      );
      expect(replies()[0]).toContain("/refresh_secrets");
    });

    it("refreshes secrets without scraping", async () => {
      const handlers = createHandlers();
      const { send, replies } = registerBot(handlers);
      await send("/refresh_secrets");
      expect(handlers.refreshSecrets).toHaveBeenCalledTimes(1);
      expect(handlers.scrape).not.toHaveBeenCalled();
      expect(replies()).toEqual(["Secrets refreshed"]);
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

  describe("scrape_provider", () => {
    const choices = [
      { id: "aaa111", label: "isracard · ••3456", failedLastRun: true },
      { id: "bbb222", label: "max · ••7890", failedLastRun: false },
    ];

    it("offers one button per configured account, marking last run's failures", async () => {
      const handlers = createHandlers({
        listAccounts: jest.fn().mockResolvedValue(choices),
      });
      const { send, replies, replyMarkups, callApi } = registerBot(handlers);

      await send("/scrape_provider");

      expect(replies()[0]).toContain("Pick a provider/account to scrape:");
      expect(replyMarkups()[0]).toEqual({
        inline_keyboard: [
          [
            {
              text: "❌ isracard · ••3456",
              callback_data: "scrape_provider:aaa111",
            },
          ],
          [
            {
              text: "▶️ max · ••7890",
              callback_data: "scrape_provider:bbb222",
            },
          ],
        ],
      });
      expect(callApi).toHaveBeenCalledWith(
        "setMyCommands",
        expect.objectContaining({
          commands: expect.arrayContaining([
            { command: "scrape_provider", description: expect.any(String) },
          ]),
        }),
      );
    });

    it("reports when no accounts are configured", async () => {
      const { send, replies, replyMarkups } = registerBot(
        createHandlers({ listAccounts: jest.fn().mockResolvedValue([]) }),
      );

      await send("/scrape_provider");

      expect(replies()).toEqual(["No accounts are configured to scrape."]);
      expect(replyMarkups()).toEqual([undefined]);
    });

    it("scrapes only the tapped account and retires the keyboard", async () => {
      const handlers = createHandlers({
        listAccounts: jest.fn().mockResolvedValue(choices),
      });
      const { tap, edits } = registerBot(handlers);

      await tap("scrape_provider:aaa111");

      expect(handlers.scrape).toHaveBeenCalledWith(["aaa111"]);
      expect(edits()).toEqual([
        expect.objectContaining({
          text: "▶️ isracard · ••3456\n🔄 Starting a scrape now...",
          reply_markup: { inline_keyboard: [] },
        }),
      ]);
    });

    it("starts no run for an account that is no longer configured", async () => {
      const handlers = createHandlers({
        listAccounts: jest.fn().mockResolvedValue([choices[1]]),
      });
      const { tap, edits } = registerBot(handlers);

      await tap("scrape_provider:aaa111");

      expect(handlers.scrape).not.toHaveBeenCalled();
      expect(edits()[0].text).toContain("no longer configured");
      expect(edits()[0].reply_markup).toEqual({ inline_keyboard: [] });
    });

    it("ignores picker taps from other chats", async () => {
      const handlers = createHandlers({
        listAccounts: jest.fn().mockResolvedValue(choices),
      });
      const { send, tap, replies, edits } = registerBot(handlers);

      await send("/scrape_provider", 999);
      await tap("scrape_provider:aaa111", 999);

      expect(replies()).toEqual([]);
      expect(edits()).toEqual([]);
      expect(handlers.scrape).not.toHaveBeenCalled();
    });

    it("is absent from the menu and from /help without a way to list accounts", async () => {
      const { send, replies, callApi } = registerBot(createHandlers());

      expect(callApi).toHaveBeenCalledWith(
        "setMyCommands",
        expect.objectContaining({
          commands: expect.not.arrayContaining([
            { command: "scrape_provider", description: expect.any(String) },
          ]),
        }),
      );
      await send("/scrape_provider");
      expect(replies()).toEqual([]);
      await send("/help");
      expect(replies()).toHaveLength(1);
      expect(replies()[0]).not.toContain("/scrape_provider");
    });

    it("suffixes the labels that would read alike, and leaves the others alone", async () => {
      const colliding = [
        {
          id: "aaa11111",
          label: "isracard · ••1111 · n•••",
          failedLastRun: true,
        },
        {
          id: "bbb22222",
          label: "isracard · ••1111 · n•••",
          failedLastRun: false,
        },
        { id: "ccc33333", label: "max · ••7890", failedLastRun: false },
      ];
      const { send, replyMarkups } = registerBot(
        createHandlers({
          listAccounts: jest.fn().mockResolvedValue(colliding),
        }),
      );

      await send("/scrape_provider");

      expect(
        (replyMarkups()[0]?.inline_keyboard ?? []).map(
          ([button]) => button.text,
        ),
      ).toEqual([
        "❌ isracard · ••1111 · n••• #aaa1",
        "▶️ isracard · ••1111 · n••• #bbb2",
        // Nothing to disambiguate: unchanged
        "▶️ max · ••7890",
      ]);
      expect(
        (replyMarkups()[0]?.inline_keyboard ?? []).map(
          ([button]) => button.callback_data,
        ),
      ).toEqual([
        "scrape_provider:aaa11111",
        "scrape_provider:bbb22222",
        "scrape_provider:ccc33333",
      ]);
    });

    it("names the tapped account with the same suffix the button had", async () => {
      const { tap, edits } = registerBot(
        createHandlers({
          listAccounts: jest.fn().mockResolvedValue([
            {
              id: "aaa11111",
              label: "isracard · ••1111 · n•••",
              failedLastRun: false,
            },
            {
              id: "bbb22222",
              label: "isracard · ••1111 · n•••",
              failedLastRun: false,
            },
          ]),
        }),
      );

      await tap("scrape_provider:bbb22222");

      expect(edits()[0].text).toBe(
        "▶️ isracard · ••1111 · n••• #bbb2\n🔄 Starting a scrape now...",
      );
    });

    it("keeps a suffix from colliding with a label that already exists", () => {
      expect(
        disambiguateLabels([
          { id: "aaaa0000", label: "isracard", failedLastRun: false },
          { id: "bbbb0000", label: "isracard", failedLastRun: false },
          { id: "cccc0000", label: "isracard #aaaa", failedLastRun: false },
        ]).map(({ label }) => label),
      ).toEqual(["isracard #aaaa0000", "isracard #bbbb", "isracard #aaaa"]);
    });

    it("lists the command in /help when accounts can be listed", async () => {
      const { send, replies } = registerBot(
        createHandlers({ listAccounts: jest.fn().mockResolvedValue(choices) }),
      );

      await send("/help");

      expect(replies()[0]).toContain("/scrape_provider");
    });
  });
});
