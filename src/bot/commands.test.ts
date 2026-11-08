import { Context, Telegram, Telegraf } from "telegraf";
import { CommandHandlers, formatStatus, registerCommands } from "./commands.js";
import { createBot, isAuthorizedChat } from "./bot.js";
import { selectionChoices } from "../selection.js";
import { getEventListeners } from "node:events";
import { mock } from "jest-mock-extended";
import { labeledScrapeResults } from "../utils/tests.js";

jest.mock("../config.js", () => ({
  config: {
    options: { notifications: { telegram: { chatId: "555" } } },
  },
}));

const chatId = 555;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function createContext(id: number) {
  return { chat: { id } } as unknown as Context;
}

function createHandlers(overrides: Partial<CommandHandlers> = {}) {
  return mock({
    scrape: jest.fn().mockResolvedValue("🔄 Starting a scrape now..."),
    refreshSecrets: jest.fn().mockResolvedValue("Secrets refreshed"),
    isRunning: jest.fn().mockResolvedValue(false),
    getLastRun: jest.fn().mockReturnValue(undefined),
    getNextRunAt: jest.fn().mockReturnValue(undefined),
    getCommandAvailability: undefined,
    ...overrides,
  } satisfies CommandHandlers);
}

function registerBot(
  handlers: CommandHandlers,
  menu: { chatId?: string } = { chatId: String(chatId) },
) {
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
  const stateChanges = new EventTarget();
  const lifetime = new AbortController();
  const registration = jest.spyOn(bot, "command");
  registerCommands(bot, handlers, {
    stateChanges,
    signal: lifetime.signal,
    ...menu,
  });
  async function stateChanged() {
    stateChanges.dispatchEvent(new Event("stateChanged"));
    await flush();
  }

  async function send(text: string, fromChat = chatId) {
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: fromChat, type: "private", first_name: "user" },
        from: { id: fromChat, is_bot: false, first_name: "user" },
        text,
        entities: [
          {
            type: "bot_command",
            offset: 0,
            length: text.split(/\s/, 1)[0].length,
          },
        ],
      },
    });
  }

  const replies = () =>
    callApi.mock.calls
      .filter(([method]) => method === "sendMessage")
      .map(([, payload]) => (payload as { text: string }).text);

  async function click(data: string, fromChat = chatId) {
    await bot.handleUpdate({
      update_id: 2,
      callback_query: {
        id: "selection-callback",
        from: { id: fromChat, is_bot: false, first_name: "user" },
        chat_instance: "selection-chat",
        data,
        message: {
          message_id: 1,
          date: 0,
          chat: { id: fromChat, type: "private", first_name: "user" },
          text: "Select a login",
        },
      },
    });
  }

  const keyboard = () => {
    const message = callApi.mock.calls.find(
      ([method]) => method === "sendMessage",
    )?.[1];
    if (!message || !("reply_markup" in message))
      throw new Error("Missing keyboard");
    const markup = message.reply_markup;
    if (!markup || typeof markup !== "object" || !("inline_keyboard" in markup))
      throw new Error("Missing inline keyboard");
    return markup.inline_keyboard.flat().map((button) => {
      if (!("callback_data" in button)) throw new Error("Missing callback");
      return button;
    });
  };
  return {
    send,
    click,
    replies,
    callApi,
    stateChanged,
    lifetime,
    stateChanges,
    keyboard,
    registration,
  };
}

describe("commands", () => {
  afterEach(() => jest.restoreAllMocks());
  describe("selection buttons", () => {
    const homeCallback = "sa:TqFAWIFQdzzjqs54au739ASc4QD6ZJyU-73blg8dqUI";
    async function setup(choices: string[] = ["home"]) {
      const getCommandAvailability = jest
        .fn()
        .mockResolvedValue({ scrapeIds: choices, scrapeFailed: false });
      const handlers = createHandlers({ getCommandAvailability });
      const bot = registerBot(handlers);
      await flush();
      return { ...bot, getCommandAvailability, scrape: handlers.scrape };
    }

    it("lists distinct allowed IDs without companies or unnamed logins", async () => {
      const buttons = await setup(
        selectionChoices([
          { companyId: "hapoalim", password: "invented", scrapeId: "home" },
          { companyId: "leumi", password: "invented", scrapeId: "home" },
          { companyId: "leumi", password: "invented" },
        ]),
      );
      await buttons.send("/scrape_accounts");
      expect(buttons.replies()).toEqual(["Choose a login to scrape now:"]);
      expect(buttons.scrape).not.toHaveBeenCalled();
      expect(buttons.keyboard()).toEqual([
        { text: "home", callback_data: homeCallback, hide: false },
      ]);
      expect(buttons.getCommandAvailability).toHaveBeenCalledTimes(1);
      await buttons.click(homeCallback);
      expect(buttons.scrape).toHaveBeenLastCalledWith({
        choices: ["home"],
      });
    });

    it("resolves buttons from the last configuration refresh", async () => {
      const buttons = await setup();
      buttons.getCommandAvailability.mockClear();
      jest.mocked(buttons.scrape).mockImplementation(async () => {
        expect(buttons.getCommandAvailability).not.toHaveBeenCalled();
        return "🔄 Scrape started";
      });
      buttons.getCommandAvailability.mockResolvedValue({
        scrapeIds: [],
        scrapeFailed: false,
      });
      await buttons.click(homeCallback);
      expect(buttons.scrape).toHaveBeenCalledWith({ choices: ["home"] });
      expect(buttons.getCommandAvailability).not.toHaveBeenCalled();
      await buttons.stateChanged();
      expect(buttons.getCommandAvailability).toHaveBeenCalledTimes(1);
      await buttons.click(homeCallback);
      await buttons.send("/scrape_accounts");
      expect(buttons.scrape).toHaveBeenCalledTimes(1);
      expect(buttons.replies().slice(-2)).toEqual([
        "Selection is no longer available. Open /scrape_accounts again.",
        "This command is currently unavailable.",
      ]);
      buttons.getCommandAvailability.mockResolvedValue({
        scrapeIds: ["home", "new"],
        scrapeFailed: false,
      });
      await buttons.stateChanged();
      buttons.callApi.mockClear();
      await buttons.send("/scrape_accounts");
      expect(buttons.keyboard().map(({ text }) => text)).toEqual([
        "home",
        "new",
      ]);
    });

    it("does not let an older refresh replace a newer one", async () => {
      const older = Promise.withResolvers<{
        scrapeIds: string[];
        scrapeFailed: boolean;
      }>();
      const getCommandAvailability = jest
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockResolvedValue({ scrapeIds: ["new"], scrapeFailed: false });
      const bot = registerBot(createHandlers({ getCommandAvailability }));
      await bot.stateChanged();
      older.resolve({ scrapeIds: ["old"], scrapeFailed: false });
      await flush();
      await flush();
      await bot.send("/scrape_accounts");
      expect(bot.keyboard().map(({ text }) => text)).toEqual(["new"]);
    });

    it.each(["private label", "שם / : !", "a".repeat(1000)])(
      "encodes arbitrary aliases within Telegram's callback byte limit (%#)",
      async (scrapeId) => {
        const buttons = await setup([scrapeId]);
        await buttons.send("/scrape_accounts");
        const { callback_data } = buttons.keyboard()[0];
        expect(callback_data).toMatch(/^sa:[A-Za-z0-9_-]{43}$/);
        expect(Buffer.byteLength(callback_data)).toBeLessThanOrEqual(64);
        expect(buttons.keyboard()[0].text).toBe(scrapeId);
        await buttons.click(callback_data);
        expect(buttons.scrape).toHaveBeenCalledWith({
          choices: [scrapeId],
        });
      },
    );

    it("rejects malformed or unknown tokens without starting", async () => {
      const buttons = await setup();
      for (const token of [
        "sa:" + "a".repeat(61),
        "sa:invalid space",
        "sa:" + "x".repeat(43),
      ]) {
        await buttons.click(token);
      }
      expect(buttons.scrape).not.toHaveBeenCalled();
      expect(buttons.replies()).toEqual(
        Array(3).fill(
          "Selection is no longer available. Open /scrape_accounts again.",
        ),
      );
    });

    it("explains an empty scope without starting", async () => {
      const buttons = await setup([]);
      await buttons.send("/scrape_accounts");
      expect(buttons.replies()).toEqual([
        "This command is currently unavailable.",
      ]);
      expect(buttons.scrape).not.toHaveBeenCalled();
    });
  });
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
    it("uses recorded failed labels, groups duplicates per provider and never fetches configuration", async () => {
      const handlers = createHandlers({
        getLastRun: jest.fn().mockReturnValue({
          trigger: "manual",
          startedAt: new Date("2026-03-01T09:00:00"),
          endedAt: new Date("2026-03-01T09:02:00"),
          failed: true,
          failedLogins: labeledScrapeResults()
            .filter(({ result }) => !result.success)
            .map(({ companyId, scrapeId }) => ({ companyId, scrapeId })),
        }),
        getCommandAvailability: jest.fn(),
      });

      expect((await formatStatus(handlers)).split("\n")).toMatchSnapshot();
      expect(handlers.getCommandAvailability).not.toHaveBeenCalled();
      expect(handlers.refreshSecrets).not.toHaveBeenCalled();
    });

    it.each([
      { count: 15, label: "home-bank" },
      { count: 15, label: "🏡".repeat(300) },
      { count: 1, label: "<&>".repeat(2000) },
    ])(
      "bounds failed labels (count=$count, label length varies)",
      async ({ count, label }) => {
        const failedLogins = Array.from({ length: count }, (_, index) => ({
          companyId: labeledScrapeResults()[0].companyId,
          scrapeId: `${label} ${index}`,
        }));
        const status = await formatStatus(
          createHandlers({
            getLastRun: jest.fn().mockReturnValue({
              trigger: "manual",
              startedAt: new Date("2026-03-01T09:00:00"),
              endedAt: new Date("2026-03-01T09:02:00"),
              failed: true,
              failedLogins,
            }),
          }),
        );

        expect(status.length).toBeLessThan(4096);
        expect(status).toMatchSnapshot();
      },
    );

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
    it.each([false, true])(
      "builds /help from the current menu without fetching configuration (provider=%s)",
      async (provider) => {
        const getCommandAvailability = jest.fn().mockResolvedValue({
          scrapeIds: [],
          scrapeFailed: false,
        });
        const handlers = createHandlers({
          refreshSecrets: provider
            ? jest.fn().mockResolvedValue("refreshed")
            : undefined,
          getCommandAvailability,
        });
        const bot = registerBot(handlers);
        const expectHelp = async () => {
          const menu = bot.callApi.mock.calls
            .filter(([method]) => method === "setMyCommands")
            .at(-1)?.[1] as {
            commands: { command: string; description: string }[];
          };
          const calls = getCommandAvailability.mock.calls.length;
          await bot.send("/help");
          expect(bot.replies().at(-1)).toBe(
            [
              "Moneyman is running and listening for commands:",
              "",
              ...menu.commands.map(
                ({ command, description }) => `/${command} — ${description}`,
              ),
            ].join("\n"),
          );
          expect(getCommandAvailability).toHaveBeenCalledTimes(calls);
          expect(bot.replies().at(-1)).toContain("/help");
          if (provider)
            expect(bot.replies().at(-1)).toContain("/refresh_secrets");
          else expect(bot.replies().at(-1)).not.toContain("/refresh_secrets");
        };
        await flush();
        await expectHelp();
        expect(bot.replies().at(-1)).not.toContain("/scrape_failed");
        getCommandAvailability.mockResolvedValue({
          scrapeIds: ["home"],
          scrapeFailed: true,
        });
        await bot.stateChanged();
        await expectHelp();
        expect(bot.replies().at(-1)).toContain("/scrape_accounts");
        expect(bot.replies().at(-1)).toContain("/scrape_failed");
        expect(handlers.scrape).not.toHaveBeenCalled();
        if (provider) expect(handlers.refreshSecrets).not.toHaveBeenCalled();
      },
    );
    it("refreshes the menu after a secret refresh returns or throws", async () => {
      const available = { scrapeIds: ["home"], scrapeFailed: false };
      const getCommandAvailability = jest.fn().mockResolvedValue(available);
      const handlers = createHandlers({ getCommandAvailability });
      const bot = registerBot(handlers);
      await flush();
      bot.callApi.mockClear();
      await bot.send("/refresh_secrets");
      expect(bot.callApi.mock.calls.map(([method]) => method)).toEqual([
        "sendMessage",
        "setMyCommands",
      ]);
      jest
        .mocked(handlers.refreshSecrets)
        .mockRejectedValue(new Error("refresh failed"));
      bot.callApi.mockClear();
      await bot.send("/refresh_secrets");
      expect(bot.callApi.mock.calls.map(([method]) => method)).toEqual([
        "setMyCommands",
        "sendMessage",
      ]);
      expect(bot.replies().at(-1)).toBe("❌ Failed to handle the command");
    });

    it("refreshes visibility after a stale button without starting a scrape", async () => {
      const handlers = createHandlers();
      const bot = registerBot(handlers);
      await flush();
      bot.callApi.mockClear();
      await bot.click("sa:removed");
      expect(bot.callApi.mock.calls.map(([method]) => method)).toEqual([
        "answerCallbackQuery",
        "sendMessage",
        "setMyCommands",
      ]);
      expect(handlers.scrape).not.toHaveBeenCalled();
    });

    it("does not refresh the menu for scrape replies, listings, status, help, OTPs or unauthorized updates", async () => {
      const getCommandAvailability = jest.fn().mockResolvedValue({
        scrapeIds: ["home"],
        scrapeFailed: true,
      });
      const bot = registerBot(createHandlers({ getCommandAvailability }));
      await flush();
      bot.callApi.mockClear();
      getCommandAvailability.mockClear();
      await bot.send("/scrape");
      await bot.send("/scrape_failed");
      await bot.send("/scrape_accounts");
      await bot.send("/status");
      await bot.send("/help");
      await bot.send("123456");
      await bot.send("/scrape", 999);
      await bot.click("sa:removed", 999);
      expect(
        bot.callApi.mock.calls.some(([method]) => method === "setMyCommands"),
      ).toBe(false);
      expect(getCommandAvailability).not.toHaveBeenCalled();
    });

    it("handles menu publication failures without replying to the chat", async () => {
      const bot = registerBot(createHandlers());
      await flush();
      bot.callApi.mockRejectedValueOnce(new Error("menu unavailable"));
      await bot.stateChanged();
      expect(bot.replies()).toEqual([]);
    });

    it("keeps optional commands unavailable if the initial availability refresh fails", async () => {
      const getCommandAvailability = jest
        .fn()
        .mockRejectedValue(new Error("provider unavailable"));
      const handlers = createHandlers({ getCommandAvailability });
      const bot = registerBot(handlers);
      await bot.stateChanged();
      expect(bot.replies()).toEqual([]);
      await bot.send("/scrape_failed");
      await bot.send("/scrape_accounts");
      expect(bot.replies()).toEqual([
        "This command is currently unavailable.",
        "This command is currently unavailable.",
      ]);
      expect(handlers.scrape).not.toHaveBeenCalled();
      await bot.send("/scrape");
      await bot.send("/status");
      expect(handlers.scrape).toHaveBeenCalledTimes(1);
      expect(bot.replies().at(-1)).toContain("😴 Idle");
    });

    it("registers the command menu", async () => {
      const { callApi } = registerBot(createHandlers());
      await flush();

      expect(callApi).toHaveBeenCalledWith(
        "setMyCommands",
        expect.objectContaining({
          scope: { type: "chat", chat_id: "555" },
          commands: expect.arrayContaining([
            { command: "scrape", description: expect.any(String) },
            { command: "refresh_secrets", description: expect.any(String) },
          ]),
        }),
      );
    });

    it.each([undefined, ""])(
      "does not publish global commands when chat ID is %p",
      async (chatId) => {
        const getCommandAvailability = jest.fn();
        const bot = registerBot(createHandlers({ getCommandAvailability }), {
          chatId,
        });
        await flush();
        await bot.stateChanged();
        await bot.send("/scrape");

        expect(getCommandAvailability).not.toHaveBeenCalled();
        expect(
          bot.callApi.mock.calls.some(([method]) => method === "setMyCommands"),
        ).toBe(false);
      },
    );

    it("hides and blocks refresh without a provider", async () => {
      const getCommandAvailability = jest.fn().mockResolvedValue({
        scrapeIds: [],
        scrapeFailed: false,
      });
      const { send, replies, callApi } = registerBot(
        createHandlers({ refreshSecrets: undefined, getCommandAvailability }),
      );
      await flush();

      expect(callApi).toHaveBeenCalledWith(
        "setMyCommands",
        expect.objectContaining({
          commands: expect.not.arrayContaining([
            { command: "refresh_secrets", description: expect.any(String) },
          ]),
        }),
      );
      await send("/refresh_secrets");
      expect(replies()).toEqual(["This command is currently unavailable."]);
      expect(getCommandAvailability).toHaveBeenCalledTimes(1);
    });

    it("uses the same current availability for the menu and typed commands without registering again", async () => {
      const getCommandAvailability = jest.fn().mockResolvedValue({
        scrapeIds: [],
        scrapeFailed: false,
      });
      const handlers = createHandlers({ getCommandAvailability });
      const { send, click, replies, callApi, stateChanged, registration } =
        registerBot(handlers);
      const menu = () =>
        callApi.mock.calls
          .filter(([method]) => method === "setMyCommands")
          .at(-1)?.[1];
      await flush();
      expect(menu()).toEqual(
        expect.objectContaining({
          commands: expect.not.arrayContaining([
            expect.objectContaining({ command: "scrape_accounts" }),
            expect.objectContaining({ command: "scrape_failed" }),
          ]),
        }),
      );
      await send("/scrape_failed");
      await send("/scrape_accounts");
      expect(replies()).toEqual([
        "This command is currently unavailable.",
        "This command is currently unavailable.",
      ]);
      expect(handlers.scrape).not.toHaveBeenCalled();
      getCommandAvailability.mockResolvedValue({
        scrapeIds: ["home"],
        scrapeFailed: true,
      });
      await stateChanged();
      expect(menu()).toEqual(
        expect.objectContaining({
          commands: expect.arrayContaining([
            expect.objectContaining({ command: "scrape_accounts" }),
            expect.objectContaining({ command: "scrape_failed" }),
          ]),
        }),
      );
      await send("/scrape_failed");
      await send("/scrape_accounts");
      expect(handlers.scrape).toHaveBeenCalledWith({ retryFailed: true });
      expect(replies().at(-1)).toBe("Choose a login to scrape now:");
      getCommandAvailability.mockResolvedValue({
        scrapeIds: [],
        scrapeFailed: false,
      });
      await stateChanged();
      expect(menu()).toEqual(
        expect.objectContaining({
          commands: expect.not.arrayContaining([
            expect.objectContaining({ command: "scrape_accounts" }),
            expect.objectContaining({ command: "scrape_failed" }),
          ]),
        }),
      );
      await send("/scrape_failed");
      await send("/scrape_accounts");
      await click("sa:TqFAWIFQdzzjqs54au739ASc4QD6ZJyU-73blg8dqUI");
      expect(replies().slice(-3)).toEqual([
        "This command is currently unavailable.",
        "This command is currently unavailable.",
        "Selection is no longer available. Open /scrape_accounts again.",
      ]);
      expect(handlers.scrape).toHaveBeenCalledTimes(1);
      expect(registration).toHaveBeenCalledTimes(6);
      const menus = callApi.mock.calls.filter(
        ([method]) => method === "setMyCommands",
      );
      expect(menus).toHaveLength(4);
      for (const [, payload] of menus) {
        expect(payload).toEqual(
          expect.objectContaining({
            scope: { type: "chat", chat_id: "555" },
          }),
        );
      }
      expect(menus[1][1]).toEqual(
        expect.objectContaining({
          commands: [
            { command: "scrape", description: "Scrape now" },
            { command: "scrape_accounts", description: "Choose an account" },
            { command: "scrape_failed", description: "Retry failed accounts" },
            { command: "refresh_secrets", description: "Refresh secrets" },
            { command: "status", description: "Run status" },
            { command: "help", description: "List the available commands" },
          ],
        }),
      );
    });

    it("stops refreshing when its owning lifetime ends", async () => {
      const getCommandAvailability = jest.fn().mockResolvedValue({
        scrapeIds: [],
        scrapeFailed: false,
      });
      const bot = registerBot(createHandlers({ getCommandAvailability }));
      await flush();
      bot.callApi.mockClear();
      getCommandAvailability.mockClear();
      bot.lifetime.abort();
      expect(getEventListeners(bot.stateChanges, "stateChanged")).toEqual([]);
      await bot.stateChanged();
      await bot.send("/scrape");
      expect(getCommandAvailability).not.toHaveBeenCalled();
      expect(
        bot.callApi.mock.calls.some(([method]) => method === "setMyCommands"),
      ).toBe(false);
    });

    it.each(["initial", "stateChanged"])(
      "does not publish a pending %s menu after disposal",
      async (refresh) => {
        const availability = Promise.withResolvers<{
          scrapeIds: string[];
          scrapeFailed: boolean;
        }>();
        const getCommandAvailability = jest.fn().mockResolvedValue({
          scrapeIds: [],
          scrapeFailed: false,
        });
        if (refresh === "initial")
          getCommandAvailability.mockReturnValueOnce(availability.promise);
        const bot = registerBot(createHandlers({ getCommandAvailability }));
        if (refresh === "stateChanged") {
          await flush();
          bot.callApi.mockClear();
          getCommandAvailability.mockReturnValueOnce(availability.promise);
          bot.stateChanges.dispatchEvent(new Event("stateChanged"));
        }
        bot.lifetime.abort();
        availability.resolve({ scrapeIds: ["home"], scrapeFailed: true });
        await flush();
        expect(bot.callApi).not.toHaveBeenCalled();
      },
    );

    it.each(["/scrape", "/fetch"])(
      "runs a scrape for %s and replies",
      async (command) => {
        const handlers = createHandlers();
        const { send, replies } = registerBot(handlers);

        await send(command);

        expect(handlers.scrape).toHaveBeenCalledTimes(1);
        expect(handlers.scrape).toHaveBeenCalledWith(undefined);
        expect(replies()).toEqual(["🔄 Starting a scrape now..."]);
      },
    );

    it.each(["/scrape", "/fetch", "/scrape@moneyman_bot"])(
      "treats the entire %s payload as one literal scrape ID",
      async (command) => {
        const handlers = createHandlers();
        const { send } = registerBot(handlers);
        for (const scrapeId of [
          "home",
          "private label",
          "שם / : !",
          " home ",
        ]) {
          await send(`${command} ${scrapeId}`);
          expect(handlers.scrape).toHaveBeenLastCalledWith({
            choices: [scrapeId],
          });
        }
        expect(handlers.scrape).toHaveBeenCalledTimes(4);
      },
    );

    it("replies with the runner's unknown-ID result without retrying the full scope", async () => {
      const handlers = createHandlers({
        scrape: jest.fn().mockResolvedValue("❌ Unknown scrapeId: removed"),
      });
      const { send, replies } = registerBot(handlers);
      await send("/scrape removed");
      expect(handlers.scrape).toHaveBeenCalledTimes(1);
      expect(handlers.scrape).toHaveBeenCalledWith({
        choices: ["removed"],
      });
      expect(replies()).toEqual(["❌ Unknown scrapeId: removed"]);
    });

    it.each(["result", "throw", "reply failure", "acknowledgement failure"])(
      "acknowledges a selection without an extra refresh around its shared scrape handler (%s)",
      async (outcome) => {
        const handlers = createHandlers({
          getCommandAvailability: jest
            .fn()
            .mockResolvedValue({ scrapeIds: ["home"], scrapeFailed: false }),
        });
        const { click, callApi, replies } = registerBot(handlers);
        await flush();
        callApi.mockClear();
        if (outcome === "throw") {
          jest
            .mocked(handlers.scrape)
            .mockRejectedValue(new Error("scrape failed"));
        } else if (outcome === "acknowledgement failure") {
          callApi.mockRejectedValueOnce(new Error("acknowledgement failed"));
        } else {
          jest.mocked(handlers.scrape).mockImplementation(async () => {
            expect(callApi.mock.calls.map(([method]) => method)).toEqual([
              "answerCallbackQuery",
            ]);
            if (outcome === "reply failure")
              callApi.mockRejectedValueOnce(new Error("reply failed"));
            return "❌ Selection is no longer allowed";
          });
        }
        await click("sa:TqFAWIFQdzzjqs54au739ASc4QD6ZJyU-73blg8dqUI");
        if (outcome === "acknowledgement failure") {
          expect(handlers.scrape).not.toHaveBeenCalled();
        } else {
          expect(handlers.scrape).toHaveBeenCalledTimes(1);
          expect(handlers.scrape).toHaveBeenCalledWith({
            choices: ["home"],
          });
        }
        expect(callApi.mock.calls.map(([method]) => method)).toEqual([
          "answerCallbackQuery",
          ...(["throw", "acknowledgement failure"].includes(outcome)
            ? []
            : ["sendMessage"]),
          ...(outcome === "result" ? [] : ["sendMessage"]),
        ]);
        expect(replies().at(-1)).toBe(
          outcome === "result"
            ? "❌ Selection is no longer allowed"
            : "❌ Failed to handle the command",
        );
      },
    );

    it("ignores commands from other chats", async () => {
      const handlers = createHandlers();
      const { send, replies } = registerBot(handlers);

      await send("/scrape", 999);
      await send("/status", 999);
      await send("/help", 999);
      await send("/refresh_secrets", 999);
      await send("/scrape_failed", 999);
      await send("/scrape_accounts", 999);

      expect(handlers.scrape).not.toHaveBeenCalled();
      expect(handlers.refreshSecrets).not.toHaveBeenCalled();
      expect(replies()).toEqual([]);
    });

    it("authorizes selection commands and callbacks through the shared middleware", async () => {
      const handlers = createHandlers({
        getCommandAvailability: jest
          .fn()
          .mockResolvedValue({ scrapeIds: ["home"], scrapeFailed: false }),
      });
      const { send, click, replies, callApi } = registerBot(handlers);
      await flush();
      callApi.mockClear();

      await send("/scrape_accounts", 999);
      const homeCallback = "sa:TqFAWIFQdzzjqs54au739ASc4QD6ZJyU-73blg8dqUI";
      await click(homeCallback, 999);

      expect(handlers.scrape).not.toHaveBeenCalled();
      expect(replies()).toEqual([]);
      expect(
        callApi.mock.calls.some(([method]) => method === "answerCallbackQuery"),
      ).toBe(false);

      await send("/scrape_accounts");
      await click(homeCallback);

      expect(handlers.scrape).toHaveBeenNthCalledWith(1, {
        choices: ["home"],
      });
      expect(
        callApi.mock.calls.filter(
          ([method]) => method === "answerCallbackQuery",
        ),
      ).toHaveLength(1);
    });

    it("refreshes secrets without scraping", async () => {
      const handlers = createHandlers();
      const { send, replies } = registerBot(handlers);
      await send("/refresh_secrets");
      expect(handlers.refreshSecrets).toHaveBeenCalledTimes(1);
      expect(handlers.scrape).not.toHaveBeenCalled();
      expect(replies()).toEqual(["Secrets refreshed"]);
    });

    it("delegates failed-login retry without widening configured scope", async () => {
      const handlers = createHandlers({
        getCommandAvailability: jest
          .fn()
          .mockResolvedValue({ scrapeIds: ["home"], scrapeFailed: true }),
      });
      const { send } = registerBot(handlers);
      await flush();
      await send("/scrape_failed");
      expect(handlers.scrape).toHaveBeenCalledWith({ retryFailed: true });
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
