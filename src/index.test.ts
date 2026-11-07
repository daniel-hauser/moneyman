import type { AccountScrapeResult, RunnerHooks, RunTrigger } from "./types.js";
import type { ServerRunner } from "./server.js";
import { createRunReport } from "./bot/runReport.js";
import { mock, mockDeep } from "jest-mock-extended";
import type { Context, Telegraf } from "telegraf";
import type { Message } from "telegraf/types";
import { aborted } from "node:util";
import { CompanyTypes } from "israeli-bank-scrapers";
import { CustomElementRegistry } from "@lit-labs/ssr-dom-shim";
import type { ReportTransport } from "./bot/reportPublisher.js";
import { locks } from "node:worker_threads";

jest.mock("./bot/runReport.js", () => {
  const actual =
    jest.requireActual<typeof import("./bot/runReport.js")>(
      "./bot/runReport.js",
    );
  return { ...actual, renderHTMLReport: jest.fn(actual.renderHTMLReport) };
});

jest.mock("./config.js", () => ({
  config: jest
    .requireActual<typeof import("./config.schema.js")>("./config.schema.js")
    .MoneymanConfigSchema.parse({}),
  getScraperConfig: jest.fn((snapshot) => ({
    accounts: snapshot.accounts,
    ...snapshot.options.scraping,
    ...snapshot.options.security,
  })),
  sendConfigToTelegramIfRequested: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./scraper/client.js", () => ({ scrapeAccounts: jest.fn() }));
jest.mock("./bot/index.js", () => ({
  runWithStorage: jest.fn(
    jest.requireActual<typeof import("./bot/index.js")>("./bot/index.js")
      .runWithStorage,
  ),
}));
jest.mock("./bot/storage/index.js", () => ({
  createStorages: jest.fn(() => [{}]),
  saveResults: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./configRefresh.js", () => ({
  hasConfigSecretProvider: jest.fn(() => false),
  loadRunConfig: jest.fn(async () => (await import("./config.js")).config),
  SECRET_REFRESH_FAILURE:
    "Secret refresh failed. No scrape started. Check the private logs and provider access, then retry.",
}));
jest.mock("./bot/notifier.js", () => ({
  __esModule: true,
  sendError: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
  launchTelegramBot: jest.fn(() => new Promise<void>(() => {})),
  stopTelegramBot: jest.fn().mockResolvedValue(undefined),
  shutdownTelegramBot: jest.fn().mockResolvedValue(undefined),
  requestOtpCode: jest.fn().mockResolvedValue("123456"),
  sendPhotos: jest.fn().mockResolvedValue(undefined),
  reportTransport: undefined,
}));
jest.mock("./server.js", () => ({ startServer: jest.fn() }));
jest.mock("./utils/secure-log.js", () => ({
  enableDebugLoggingIfNeeded: jest.fn(),
  sendLogFile: jest.fn(),
  readReportLogs: jest.fn(),
}));
jest.mock("./runnerMetadata.js", () => ({
  getExternalIp: jest.fn().mockResolvedValue({}),
  logRunMetadata: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./security/domains.js", () => ({
  createDomainTracker: jest.fn(() => ({
    getUsedDomains: jest.fn(async () => ({
      node: { main: ["GET parent.test"] },
    })),
    dispose: jest.fn(),
  })),
}));
jest.mock("./utils/failureScreenshot.js", () => ({
  sendFailureScreenShots: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./utils/logger.js", () => ({
  createLogger: jest.fn(() => jest.fn()),
  logToPublicLog: jest.fn(),
}));

const accountResult = (
  companyId: CompanyTypes,
  success: boolean,
): AccountScrapeResult => ({ companyId, result: { success, accounts: [] } });

function hooks(): RunnerHooks {
  const mockedHooks = mock<RunnerHooks>();
  mockedHooks.onBeforeStart.mockResolvedValue(undefined);
  mockedHooks.onStatusChanged.mockResolvedValue(undefined);
  mockedHooks.onResultsReady.mockResolvedValue(undefined);
  mockedHooks.onError.mockResolvedValue(undefined);
  mockedHooks.failureScreenshotsHandler.mockResolvedValue(undefined);
  return mockedHooks;
}

async function loadEntrypoint(
  longRunning: boolean,
  providerConfigured = false,
  configureScrape?: (
    scrape: jest.MockedFunction<
      typeof import("./scraper/client.js").scrapeAccounts
    >,
    notifier: typeof import("./bot/notifier.js"),
  ) => void,
  configureLifecycle?: (mocks: {
    sendLogFile: jest.MockedFunction<
      typeof import("./utils/secure-log.js").sendLogFile
    >;
    sendError: jest.MockedFunction<
      typeof import("./bot/notifier.js").sendError
    >;
  }) => void,
  configureConfigUpload?: (
    upload: jest.MockedFunction<
      typeof import("./config.js").sendConfigToTelegramIfRequested
    >,
  ) => void,
) {
  // Each reset loads new component constructors; isolate the SSR registry too.
  globalThis.customElements = new CustomElementRegistry();
  jest.resetModules();
  process.env.MONEYMAN_LONG_RUNNING = longRunning ? "true" : "";
  let started!: () => void;
  const startup = new Promise<void>((resolve) => (started = resolve));
  const exit = jest
    .spyOn(process, "exit")
    .mockImplementation((() => started()) as never);

  const { scrapeAccounts } = await import("./scraper/client.js");
  const { runWithStorage } = await import("./bot/index.js");
  const { sendLogFile } = await import("./utils/secure-log.js");
  const { startServer } = await import("./server.js");
  const { runContextStore } = await import("./utils/asyncContext.js");
  const { hasConfigSecretProvider } = await import("./configRefresh.js");
  const { sendConfigToTelegramIfRequested } = await import("./config.js");
  const notifier = await import("./bot/notifier.js");
  configureLifecycle?.({
    sendLogFile: jest.mocked(sendLogFile),
    sendError: jest.mocked(notifier.sendError),
  });
  configureConfigUpload?.(jest.mocked(sendConfigToTelegramIfRequested));
  jest.mocked(hasConfigSecretProvider).mockReturnValue(providerConfigured);
  const scrapeAccountsMock = jest.mocked(scrapeAccounts);
  const runWithStorageMock = jest.mocked(runWithStorage);
  const startServerMock = jest.mocked(startServer);
  scrapeAccountsMock.mockResolvedValue({ results: [], domains: {} });
  configureScrape?.(scrapeAccountsMock, notifier);
  startServerMock.mockImplementation(async () => started());

  await import("./index.js");
  await startup;

  return {
    exit,
    scrapeAccountsMock,
    runWithStorageMock,
    sendConfigToTelegramIfRequestedMock: jest.mocked(
      sendConfigToTelegramIfRequested,
    ),
    sendLogFileMock: jest.mocked(sendLogFile),
    startServerMock,
    runContextStore,
    notifier,
  };
}

describe("index", () => {
  const originalEnv = process.env;
  const originalExitCode = process.exitCode;
  let originalExceptionListeners: ReturnType<typeof process.listeners>;
  let originalRejectionListeners: ReturnType<typeof process.listeners>;
  let originalExitListeners: ReturnType<typeof process.listeners>;
  let originalSignalListeners: Map<
    "SIGINT" | "SIGTERM",
    ReturnType<typeof process.listeners>
  >;

  beforeEach(() => {
    originalExceptionListeners = process.listeners("uncaughtException");
    originalRejectionListeners = process.listeners("unhandledRejection");
    originalExitListeners = process.listeners("exit");
    originalSignalListeners = new Map(
      (["SIGINT", "SIGTERM"] as const).map((signal) => [
        signal,
        process.listeners(signal),
      ]),
    );
  });

  afterEach(() => {
    for (const listener of process.listeners("uncaughtException")) {
      if (!originalExceptionListeners.includes(listener)) {
        process.removeListener("uncaughtException", listener);
      }
    }
    for (const listener of process.listeners("unhandledRejection")) {
      if (!originalRejectionListeners.includes(listener)) {
        process.removeListener("unhandledRejection", listener);
      }
    }
    for (const listener of process.listeners("exit")) {
      if (!originalExitListeners.includes(listener))
        process.removeListener("exit", listener);
    }
    for (const [signal, original] of originalSignalListeners) {
      for (const listener of process.listeners(signal)) {
        if (!original.includes(listener))
          process.removeListener(signal, listener);
      }
    }
    process.env = originalEnv;
    process.exitCode = originalExitCode;
    jest.restoreAllMocks();
  });

  it("runs once and exits by default", async () => {
    const listeners = ["SIGINT", "SIGTERM"].map((signal) =>
      process.listenerCount(signal),
    );
    const { exit, runWithStorageMock, startServerMock, sendLogFileMock } =
      await loadEntrypoint(false, true);
    const notifier = await import("./bot/notifier.js");

    expect(runWithStorageMock).toHaveBeenCalledTimes(1);
    expect(startServerMock).not.toHaveBeenCalled();
    expect(notifier.launchTelegramBot).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
    expect(sendLogFileMock).toHaveBeenCalledWith(true, [{}], false);
    const { loadRunConfig } = await import("./configRefresh.js");
    expect(loadRunConfig).not.toHaveBeenCalled();
    expect(
      ["SIGINT", "SIGTERM"].map((signal) => process.listenerCount(signal)),
    ).toEqual(listeners);
  });

  it("removes the config upload observer after normal completion without cancelling the process", async () => {
    const combined = jest.spyOn(AbortSignal, "any");
    const result = await loadEntrypoint(true);
    const processSignal = result.startServerMock.mock.calls[0][1].signal;
    const uploadSignal = combined.mock.results[0].value as AbortSignal;

    expect(uploadSignal).not.toBe(processSignal);
    expect(getEventListeners(uploadSignal, "abort")).toEqual([]);
    expect(processSignal.aborted).toBe(false);
    expect(result.exit).not.toHaveBeenCalled();
  });

  it.each([
    [false, "SIGINT"],
    [false, "SIGTERM"],
    [true, "SIGINT"],
    [true, "SIGTERM"],
  ] as const)(
    "cancels a pending config upload before starting either mode (%s, %s)",
    async (longRunning, signal) => {
      const uploadStarted = Promise.withResolvers<void>();
      const upload = Promise.withResolvers<void>();
      const entrypoint = loadEntrypoint(
        longRunning,
        false,
        undefined,
        undefined,
        (sendConfig) =>
          sendConfig.mockImplementation(() => {
            uploadStarted.resolve();
            return upload.promise;
          }),
      );
      await uploadStarted.promise;
      process.emit(signal);

      const {
        exit,
        runWithStorageMock,
        scrapeAccountsMock,
        sendConfigToTelegramIfRequestedMock,
        startServerMock,
      } = await entrypoint;

      expect(sendConfigToTelegramIfRequestedMock).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
      expect(runWithStorageMock).not.toHaveBeenCalled();
      expect(scrapeAccountsMock).not.toHaveBeenCalled();
      expect(startServerMock).not.toHaveBeenCalled();
    },
  );

  it("preserves fatal exit status when a pending config upload is cancelled", async () => {
    const uploadStarted = Promise.withResolvers<void>();
    const upload = Promise.withResolvers<void>();
    const error = new Error("fatal during startup");
    const entrypoint = loadEntrypoint(
      false,
      false,
      undefined,
      undefined,
      (sendConfig) =>
        sendConfig.mockImplementation(() => {
          uploadStarted.resolve();
          return upload.promise;
        }),
    );
    await uploadStarted.promise;
    process.emit("uncaughtException", error, "uncaughtException");

    const { exit, runWithStorageMock, scrapeAccountsMock, startServerMock } =
      await entrypoint;

    expect(exit).toHaveBeenCalledWith(1);
    expect(runWithStorageMock).not.toHaveBeenCalled();
    expect(scrapeAccountsMock).not.toHaveBeenCalled();
    expect(startServerMock).not.toHaveBeenCalled();
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "cancels the one-shot scrape on %s and removes its signal listeners",
    async (signalName) => {
      const listeners = ["SIGINT", "SIGTERM"].map((signal) =>
        process.listenerCount(signal),
      );
      const { exit, scrapeAccountsMock } = await loadEntrypoint(
        false,
        false,
        (scrape) =>
          scrape.mockImplementationOnce(
            async (_settings, requestOtp, _status, _error, signal) => {
              expect(signal?.aborted).toBe(false);
              process.emit(signalName);
              expect(signal?.aborted).toBe(true);
              await expect(
                requestOtp("oneZero", "+97200000000", signal),
              ).rejects.toThrow();
              throw signal!.reason;
            },
          ),
      );
      const notifier = await import("./bot/notifier.js");
      expect(scrapeAccountsMock).toHaveBeenCalledTimes(1);
      expect(notifier.launchTelegramBot).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(0);
      expect(
        ["SIGINT", "SIGTERM"].map((signal) => process.listenerCount(signal)),
      ).toEqual(listeners);
    },
  );

  it("shares one lazy polling start across OTP requests and stops after the one-shot run", async () => {
    let responses: string[] = [];
    const { scrapeAccountsMock } = await loadEntrypoint(
      false,
      false,
      (scrape) =>
        scrape.mockImplementationOnce(async (_settings, requestOtp) => {
          responses = await Promise.all([
            requestOtp("oneZero", "+97200000001"),
            requestOtp("oneZero", "+97200000002"),
          ]);
          return { results: [], domains: {} };
        }),
    );
    const notifier = await import("./bot/notifier.js");

    expect(scrapeAccountsMock).toHaveBeenCalledTimes(1);
    expect(responses).toEqual(["123456", "123456"]);
    expect(notifier.launchTelegramBot).toHaveBeenCalledTimes(1);
    expect(notifier.requestOtpCode).toHaveBeenCalledTimes(2);
    expect(notifier.stopTelegramBot).toHaveBeenCalledTimes(1);
  });

  it("cleans up after polling startup fails in a one-shot run", async () => {
    let requestError: unknown;
    const { notifier } = await loadEntrypoint(
      false,
      false,
      (scrape, notifier) => {
        jest
          .mocked(notifier.launchTelegramBot)
          .mockRejectedValueOnce(new Error("polling failed"));
        jest
          .mocked(notifier.requestOtpCode)
          .mockImplementationOnce(async (_companyId, _phoneNumber, signal) => {
            if (!signal) throw new Error("Missing OTP cancellation signal");
            await aborted(signal, signal);
            signal.throwIfAborted();
            return "123456";
          });
        scrape.mockImplementationOnce(async (_settings, requestOtp) => {
          requestError = await requestOtp("oneZero", "+97200000000").catch(
            (error: unknown) => error,
          );
          return { results: [], domains: {} };
        });
      },
    );

    expect(requestError).toEqual(
      expect.objectContaining({
        message: "Failed to start Telegram bot for OTP: Error: polling failed",
      }),
    );
    expect(notifier.requestOtpCode).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledWith(
      expect.stringContaining("requestOtpCode\n❌ polling failed"),
    );
    expect(notifier.stopTelegramBot).toHaveBeenCalledTimes(1);
  });

  it("shares one polling failure and notification across concurrent OTP requests", async () => {
    let errors: PromiseSettledResult<string>[] = [];
    const { notifier } = await loadEntrypoint(
      false,
      false,
      (scrape, notifier) => {
        jest
          .mocked(notifier.launchTelegramBot)
          .mockRejectedValueOnce(new Error("polling failed"));
        jest
          .mocked(notifier.requestOtpCode)
          .mockImplementation(async (_companyId, _phoneNumber, signal) => {
            if (!signal) throw new Error("Missing OTP cancellation signal");
            await aborted(signal, signal);
            signal.throwIfAborted();
            return "123456";
          });
        scrape.mockImplementationOnce(async (_settings, requestOtp) => {
          errors = await Promise.allSettled([
            requestOtp("oneZero", "+97200000001"),
            requestOtp("oneZero", "+97200000002"),
          ]);
          return { results: [], domains: {} };
        });
      },
    );

    expect(errors).toEqual([
      expect.objectContaining({ status: "rejected" }),
      expect.objectContaining({ status: "rejected" }),
    ]);
    expect(notifier.launchTelegramBot).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.stopTelegramBot).toHaveBeenCalledTimes(1);
  });

  it("retries a failed OTP polling launch for a later account in the same run", async () => {
    const startup = Promise.withResolvers<void>();
    let recovered: string | undefined;
    const { notifier } = await loadEntrypoint(
      false,
      false,
      (scrape, notifier) => {
        jest
          .mocked(notifier.launchTelegramBot)
          .mockRejectedValueOnce(new Error("polling failed"))
          .mockReturnValueOnce(startup.promise);
        jest
          .mocked(notifier.requestOtpCode)
          .mockImplementationOnce(async (_companyId, _phoneNumber, signal) => {
            if (!signal) throw new Error("Missing OTP cancellation signal");
            await aborted(signal, signal);
            signal.throwIfAborted();
            return "123456";
          });
        scrape.mockImplementationOnce(async (_settings, requestOtp) => {
          await expect(requestOtp("oneZero", "+97200000001")).rejects.toThrow(
            "Failed to start Telegram bot for OTP: Error: polling failed",
          );
          recovered = await requestOtp("oneZero", "+97200000002");
          return { results: [], domains: {} };
        });
      },
    );
    expect(recovered).toBe("123456");
    expect(notifier.launchTelegramBot).toHaveBeenCalledTimes(2);
    expect(notifier.send).toHaveBeenCalledTimes(1);
    startup.resolve();
    await startup.promise;
  });

  it("attempts native stop once when a worker cancels while polling startup remains pending", async () => {
    const startup = Promise.withResolvers<void>();
    const bot = mockDeep<Telegraf<Context>>();
    bot.launch.mockReturnValue(startup.promise);
    bot.stop.mockImplementation(() => {
      throw new Error("Bot is not running!");
    });
    bot.telegram.sendMessage.mockResolvedValue(
      mock<Message.TextMessage>({ message_id: 1 }),
    );
    let requestError: unknown;
    try {
      const { notifier, exit } = await loadEntrypoint(
        false,
        false,
        (scrape, notifier) => {
          scrape.mockImplementationOnce(async (_settings, requestOtp) => {
            const { config } = await import("./config.js");
            const { NotificationOptionsSchema } =
              await import("./config.schema.js");
            config.options.notifications.telegram =
              NotificationOptionsSchema.parse({
                telegram: {
                  apiKey: "sample",
                  chatId: "555",
                  enableOtp: true,
                  otpTimeoutSeconds: 30,
                },
              }).telegram;
            const { createBot } = await import("./bot/bot.js");
            const controller = createBot(bot);
            jest
              .mocked(notifier.launchTelegramBot)
              .mockImplementation(controller.launchTelegramBot);
            jest
              .mocked(notifier.stopTelegramBot)
              .mockImplementation(controller.stopTelegramBot);
            jest
              .mocked(notifier.requestOtpCode)
              .mockImplementation(controller.requestOtpCode);
            const worker = new AbortController();
            const request = requestOtp(
              "oneZero",
              "+97200000000",
              worker.signal,
            );
            worker.abort(new Error("worker exited"));
            requestError = await request.catch((error: unknown) => error);
            return { results: [], domains: {} };
          });
        },
      );

      expect(requestError).toEqual(
        expect.objectContaining({ message: "worker exited" }),
      );
      expect(exit).toHaveBeenCalledWith(0);
      expect(notifier.requestOtpCode).toHaveBeenCalledTimes(1);
      expect(notifier.stopTelegramBot).toHaveBeenCalledTimes(1);
      expect(bot.stop).toHaveBeenCalledTimes(1);
      const { createLogger } = await import("./utils/logger.js");
      const loggers = jest.mocked(createLogger);
      const botLogger = loggers.mock.results
        .filter((_, index) => loggers.mock.calls[index][0] === "bot")
        .at(-1)!.value;
      expect(botLogger).toHaveBeenCalledTimes(1);
      expect(botLogger).toHaveBeenCalledWith(
        "Failed to stop the Telegram bot: Bot is not running!",
      );
    } finally {
      startup.resolve();
      await startup.promise;
    }
  });

  it("applies the OTP response timeout while polling startup is pending", async () => {
    const deadline = new AbortController();
    const timeout = jest
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    let requestError: unknown;
    const { notifier } = await loadEntrypoint(
      false,
      false,
      (scrape, notifier) => {
        scrape.mockImplementationOnce(async (_settings, requestOtp) => {
          const { config } = await import("./config.js");
          const { NotificationOptionsSchema } =
            await import("./config.schema.js");
          config.options.notifications.telegram =
            NotificationOptionsSchema.parse({
              telegram: {
                apiKey: "sample",
                chatId: "555",
                enableOtp: true,
                otpTimeoutSeconds: 30,
              },
            }).telegram;
          const { createOtpHandler } = await import("./bot/otp.js");
          const bot = mockDeep<Telegraf<Context>>();
          bot.telegram.sendMessage.mockResolvedValue(
            mock<Message.TextMessage>({ message_id: 1 }),
          );
          jest
            .mocked(notifier.requestOtpCode)
            .mockImplementation(createOtpHandler(bot));
          const request = requestOtp("oneZero", "+97200000000");
          const received = request.catch((error: unknown) => error);
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(timeout).toHaveBeenCalledWith(30_000);
          deadline.abort();
          requestError = await received;
          return { results: [], domains: {} };
        });
      },
    );

    expect(requestError).toEqual(
      expect.objectContaining({
        message: "OTP timeout: No response received within 30 seconds",
      }),
    );
    expect(notifier.launchTelegramBot).toHaveBeenCalledTimes(1);
    expect(notifier.stopTelegramBot).toHaveBeenCalledTimes(1);
  });

  it.each(["cleanup", "cleanup after signal"] as const)(
    "reports a one-shot %s failure before exiting with status 1",
    async (stage) => {
      const error = new Error(`${stage} failed`);
      error.stack = `Error: ${stage} failed\n    at lifecycle.js:1`;
      const notificationStarted = Promise.withResolvers<void>();
      const notificationFinished = Promise.withResolvers<void>();
      let exit: jest.SpyInstance | undefined;
      const entrypoint = loadEntrypoint(
        false,
        false,
        stage === "cleanup after signal"
          ? (scrape) =>
              scrape.mockImplementationOnce(async () => {
                process.emit("SIGTERM");
                return { results: [], domains: {} };
              })
          : undefined,
        (mocks) => {
          mocks.sendLogFile.mockRejectedValueOnce(error);
          mocks.sendError.mockImplementationOnce(async () => {
            notificationStarted.resolve();
            await notificationFinished.promise;
          });
          exit = jest.mocked(process.exit);
        },
      );

      await notificationStarted.promise;
      expect(exit).not.toHaveBeenCalled();
      const { sendError } = await import("./bot/notifier.js");
      expect(sendError).toHaveBeenCalledWith(
        `Unhandled rejection: ${stage} failed\nError: ${stage} failed\n    at lifecycle.js:1`,
      );
      notificationFinished.resolve();
      const result = await entrypoint;
      expect(result.exit).toHaveBeenCalledWith(1);
    },
  );

  it("reports a rejected one-shot run and exits with status 1", async () => {
    const acquired = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const held = locks.request("moneyman-scrape", async () => {
      acquired.resolve();
      await release.promise;
    });
    await acquired.promise;
    try {
      const { exit } = await loadEntrypoint(false);
      const { sendError } = await import("./bot/notifier.js");
      expect(sendError).toHaveBeenCalledWith(
        expect.stringContaining(
          "Unhandled rejection: A scrape is already in progress",
        ),
      );
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      release.resolve();
      await held;
    }
  });

  it("disposes the per-run parent tracker after scraping", async () => {
    await loadEntrypoint(false);
    const { createDomainTracker } = await import("./security/domains.js");
    const tracker = jest.mocked(createDomainTracker).mock.results[0].value;
    expect(tracker.dispose).toHaveBeenCalledTimes(1);
  });

  it("bridges worker timing updates into the real run report", async () => {
    const timing = {
      id: "scraper-1",
      kind: "scraper" as const,
      name: "hapoalim",
      startedAt: 1_000,
      endedAt: 1_100,
      failed: false,
    };
    const { runWithStorageMock } = await loadEntrypoint(
      false,
      false,
      (scrape) => {
        scrape.mockImplementationOnce(
          async (
            _settings,
            _requestOtp,
            _status,
            _error,
            _signal,
            onTiming,
          ) => {
            expect(onTiming).toEqual(expect.any(Function));
            await onTiming?.(timing);
            return { results: [], domains: {} };
          },
        );
      },
    );
    const { report } = await runWithStorageMock.mock.results[0].value;
    expect(report.timings).toEqual([timing]);
    expect(report.endedAt).toBeInstanceOf(Date);
  });

  describe("long running", () => {
    let mocks: Awaited<ReturnType<typeof loadEntrypoint>>;
    let runner: Required<ServerRunner>;

    beforeEach(async () => {
      process.env = { ...originalEnv };
      mocks = await loadEntrypoint(true, true);
      const configured = mocks.startServerMock.mock.calls[0][0];
      if (!configured.refreshSecrets)
        throw new Error("Missing configured secret refresh capability");
      runner = { ...configured, refreshSecrets: configured.refreshSecrets };
    });

    /** Runs to completion, the way the one-shot entrypoint does. */
    const runOnce = async (trigger: RunTrigger) =>
      (await runner.startRun(trigger)).finished;

    it("hands the runner to the server without running", () => {
      expect(mocks.runWithStorageMock).not.toHaveBeenCalled();
      expect(mocks.exit).not.toHaveBeenCalled();
      const processHandlers = mocks.startServerMock.mock.calls[0][1];
      expect(processHandlers.signal).toBeInstanceOf(AbortSignal);
      expect(processHandlers.waitForNotifications).toEqual(
        expect.any(Function),
      );
    });

    it("passes the server-owned OTP handler without creating a one-shot session", async () => {
      await runOnce("manual");

      expect(mocks.scrapeAccountsMock.mock.calls[0][1]).toBe(
        mocks.notifier.requestOtpCode,
      );
      expect(mocks.notifier.launchTelegramBot).not.toHaveBeenCalled();
    });

    it.each(["manual", "scheduled"] as const)(
      "refreshes before every %s scrape and passes the same fresh snapshot to storage and scraping",
      async (trigger) => {
        const { loadRunConfig } = await import("./configRefresh.js");
        const { createStorages } = await import("./bot/storage/index.js");
        const { MoneymanConfigSchema } = await import("./config.schema.js");
        const fresh = MoneymanConfigSchema.parse({
          accounts: [{ companyId: "hapoalim", password: "fresh-bank" }],
          storage: {
            webPost: {
              url: "https://fresh.test",
              authorizationToken: "fresh-storage",
            },
          },
          options: {
            scraping: {
              daysBack: 28,
              maxParallelScrapers: 3,
              includeRawTransaction: true,
            },
            security: { blockByDefault: true },
          },
        });
        const newer = structuredClone(fresh);
        newer.accounts[0].password = "newer-bank";
        newer.storage.webPost!.authorizationToken = "newer-storage";
        jest
          .mocked(loadRunConfig)
          .mockResolvedValueOnce(fresh)
          .mockResolvedValueOnce(newer);

        await runOnce(trigger);
        await runOnce(trigger);

        expect(loadRunConfig).toHaveBeenCalledTimes(2);
        expect(createStorages).toHaveBeenNthCalledWith(1, fresh);
        expect(createStorages).toHaveBeenNthCalledWith(2, newer);
        expect(mocks.scrapeAccountsMock.mock.calls[0][0]).toMatchObject({
          accounts: fresh.accounts,
          daysBack: 28,
          maxParallelScrapers: 3,
          includeRawTransaction: true,
          blockByDefault: true,
        });
        expect(
          mocks.scrapeAccountsMock.mock.calls[1][0].accounts[0].password,
        ).toBe("newer-bank");
        expect(
          jest.mocked(loadRunConfig).mock.invocationCallOrder[0],
        ).toBeLessThan(jest.mocked(createStorages).mock.invocationCallOrder[0]);
      },
    );

    it("blocks a failed automatic refresh before creating clients or scraping, reports safely and permits retry", async () => {
      const { loadRunConfig, SECRET_REFRESH_FAILURE } =
        await import("./configRefresh.js");
      const { createStorages } = await import("./bot/storage/index.js");
      const { sendError } = await import("./bot/notifier.js");
      const { logToPublicLog } = await import("./utils/logger.js");
      jest
        .mocked(loadRunConfig)
        .mockRejectedValueOnce(new Error("provider-sensitive-token"));

      expect(await runOnce("scheduled")).toMatchObject({ failed: true });
      expect(createStorages).not.toHaveBeenCalled();
      expect(mocks.scrapeAccountsMock).not.toHaveBeenCalled();
      expect(sendError).toHaveBeenCalledWith(
        new Error(SECRET_REFRESH_FAILURE),
        "Secrets refresh",
      );
      expect(logToPublicLog).toHaveBeenCalledWith(SECRET_REFRESH_FAILURE);
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(false, [], false);
      expect(await runner.isRunning()).toBe(false);
      expect(await runOnce("manual")).toMatchObject({ failed: false });
    });

    it.each(["default", "disabled", "unconfigured", "uninitialized"])(
      "honors %s Telegram reports on early setup failure",
      async (setting) => {
        const { config } = await import("./config.js");
        const { NotificationOptionsSchema } =
          await import("./config.schema.js");
        const notifier = await import("./bot/notifier.js");
        const { readReportLogs } = await import("./utils/secure-log.js");
        const { renderHTMLReport } = await import("./bot/runReport.js");
        const { loadRunConfig } = await import("./configRefresh.js");
        const transport = mock<ReportTransport>();
        transport.send.mockResolvedValue(1);
        transport.sendFile.mockResolvedValue(undefined);
        config.options.notifications = NotificationOptionsSchema.parse(
          setting === "unconfigured"
            ? {}
            : {
                telegram: {
                  apiKey: "test-token",
                  chatId: "1",
                  ...(setting === "disabled"
                    ? { sendReportFileToTelegram: false }
                    : {}),
                },
              },
        );
        jest.replaceProperty(
          notifier,
          "reportTransport",
          setting === "unconfigured" || setting === "uninitialized"
            ? undefined
            : transport,
        );
        if (setting === "uninitialized") {
          expect(
            config.options.notifications.telegram?.sendReportFileToTelegram,
          ).toBe(true);
        }
        jest.mocked(readReportLogs).mockReturnValue("invented early-run logs");
        jest
          .mocked(loadRunConfig)
          .mockRejectedValueOnce(new Error("setup failed"));

        expect(await runOnce("manual")).toMatchObject({ failed: true });

        expect(mocks.runWithStorageMock).not.toHaveBeenCalled();
        if (setting === "default") {
          expect(readReportLogs).toHaveBeenCalledTimes(1);
          expect(renderHTMLReport).toHaveBeenCalledWith(
            expect.objectContaining({ failed: true }),
            "invented early-run logs",
          );
          expect(transport.sendFile).toHaveBeenCalledWith(
            "report.html",
            expect.stringContaining("invented early-run logs"),
          );
        } else {
          expect(readReportLogs).not.toHaveBeenCalled();
          expect(renderHTMLReport).not.toHaveBeenCalled();
          expect(transport.sendFile).not.toHaveBeenCalled();
        }
        if (setting === "unconfigured" || setting === "uninitialized") {
          expect(transport.send).not.toHaveBeenCalled();
        } else {
          expect(transport.send).toHaveBeenCalledWith(
            expect.stringContaining("Starting..."),
          );
        }
        expect(mocks.sendLogFileMock).toHaveBeenCalledWith(
          false,
          [],
          setting === "default",
        );
      },
    );

    it("does not expose refresh when no provider is configured", async () => {
      const unconfigured = await loadEntrypoint(true, false);
      const { loadRunConfig } = await import("./configRefresh.js");
      expect(
        unconfigured.startServerMock.mock.calls[0][0].refreshSecrets,
      ).toBeUndefined();
      expect(loadRunConfig).not.toHaveBeenCalled();
      expect(unconfigured.scrapeAccountsMock).not.toHaveBeenCalled();
      expect(unconfigured.runWithStorageMock).not.toHaveBeenCalled();
    });

    it("actually fetches and validates for a refresh command without scraping, and still refreshes the next scrape", async () => {
      const { loadRunConfig, hasConfigSecretProvider } =
        await import("./configRefresh.js");
      jest.mocked(hasConfigSecretProvider).mockReturnValue(true);
      expect(await runner.refreshSecrets()).toBe("refreshed");
      expect(loadRunConfig).toHaveBeenCalledTimes(1);
      expect(mocks.scrapeAccountsMock).not.toHaveBeenCalled();
      expect(mocks.runWithStorageMock).not.toHaveBeenCalled();
      expect(runner.getLastRun()).toBeUndefined();
      await runOnce("manual");
      expect(loadRunConfig).toHaveBeenCalledTimes(2);
    });

    it("refreshes during scraping without altering the run's snapshot, and rejects duplicate scrapes through log delivery", async () => {
      const { loadRunConfig, hasConfigSecretProvider } =
        await import("./configRefresh.js");
      const { config } = await import("./config.js");
      const { createStorages } = await import("./bot/storage/index.js");
      const fresh = structuredClone(config);
      fresh.accounts = [{ companyId: "hapoalim", password: "retained-bank" }];
      const newer = structuredClone(fresh);
      newer.accounts[0].password = "refreshed-bank";
      jest
        .mocked(loadRunConfig)
        .mockResolvedValueOnce(fresh)
        .mockResolvedValue(newer);
      jest.mocked(hasConfigSecretProvider).mockReturnValue(true);
      const scrape =
        Promise.withResolvers<
          Awaited<
            ReturnType<typeof import("./scraper/client.js").scrapeAccounts>
          >
        >();
      mocks.scrapeAccountsMock.mockReturnValue(scrape.promise);
      const log = Promise.withResolvers<void>();
      mocks.sendLogFileMock.mockReturnValue(log.promise);

      const handle = await runner.startRun("manual");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(await runner.refreshSecrets()).toBe("refreshed");
      expect((await runner.startRun("scheduled")).started).toBe(false);
      expect(loadRunConfig).toHaveBeenCalledTimes(2);
      expect(jest.mocked(createStorages).mock.calls[0][0]).toBe(fresh);
      expect(mocks.scrapeAccountsMock.mock.calls[0][0].accounts).toBe(
        fresh.accounts,
      );
      expect(fresh.accounts[0].password).toBe("retained-bank");
      scrape.resolve({ results: [], domains: {} });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(await runner.isRunning()).toBe(true);
      expect((await runner.startRun("scheduled")).started).toBe(false);
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(
        false,
        jest.mocked(createStorages).mock.results[0].value,
        false,
      );
      log.resolve();
      await handle.finished;
      expect(await runner.isRunning()).toBe(false);
    });

    it("allows scrapes and other refreshes while a manual refresh is pending", async () => {
      const { loadRunConfig, hasConfigSecretProvider } =
        await import("./configRefresh.js");
      const { config } = await import("./config.js");
      jest.mocked(hasConfigSecretProvider).mockReturnValue(true);
      const loading = Promise.withResolvers<typeof config>();
      jest.mocked(loadRunConfig).mockReturnValueOnce(loading.promise);
      const scrape =
        Promise.withResolvers<
          Awaited<
            ReturnType<typeof import("./scraper/client.js").scrapeAccounts>
          >
        >();
      mocks.scrapeAccountsMock.mockReturnValue(scrape.promise);
      const refresh = runner.refreshSecrets();
      expect(await runner.isRunning()).toBe(false);
      const secondRefresh = runner.refreshSecrets();
      const handle = await runner.startRun("manual");
      expect(handle.started).toBe(true);
      expect((await runner.startRun("scheduled")).started).toBe(false);
      expect(await secondRefresh).toBe("refreshed");
      expect(loadRunConfig).toHaveBeenCalledTimes(3);
      scrape.resolve({ results: [], domains: {} });
      await handle.finished;
      expect(await runner.isRunning()).toBe(false);
      loading.resolve(config);
      expect(await refresh).toBe("refreshed");
    });

    it("reports a manual refresh failure without scraping and releases ownership for retry", async () => {
      const { loadRunConfig, hasConfigSecretProvider } =
        await import("./configRefresh.js");
      jest.mocked(hasConfigSecretProvider).mockReturnValue(true);
      jest
        .mocked(loadRunConfig)
        .mockRejectedValueOnce(new Error("provider-sensitive"));
      expect(await runner.refreshSecrets()).toBe("failed");
      expect(mocks.scrapeAccountsMock).not.toHaveBeenCalled();
      expect(mocks.runWithStorageMock).not.toHaveBeenCalled();
      expect(await runner.refreshSecrets()).toBe("refreshed");
    });

    it("leaves signal ownership with the server during an active run", async () => {
      const listeners = ["SIGINT", "SIGTERM"].map((signal) =>
        process.listenerCount(signal),
      );
      const pending = Promise.withResolvers<{
        results: AccountScrapeResult[];
        domains: {};
      }>();
      const started = Promise.withResolvers<void>();
      mocks.scrapeAccountsMock.mockImplementationOnce(
        (_settings, _requestOtp, _status, _error, signal) => {
          expect(signal).toBeUndefined();
          started.resolve();
          return pending.promise;
        },
      );
      const handle = await runner.startRun("manual");
      await started.promise;
      expect(
        ["SIGINT", "SIGTERM"].map((signal) => process.listenerCount(signal)),
      ).toEqual(listeners);
      pending.resolve({
        results: [accountResult(CompanyTypes.hapoalim, true)],
        domains: {},
      });
      await expect(handle.finished).resolves.toMatchObject({ failed: false });
      const { saveResults } = await import("./bot/storage/index.js");
      expect(saveResults).toHaveBeenCalled();
    });

    it("reports a run where everything worked as successful", async () => {
      const domains = { hapoalim: { allowed: ["GET bank.test"] } };
      mocks.scrapeAccountsMock.mockResolvedValue({
        results: [accountResult(CompanyTypes.hapoalim, true)],
        domains,
      });

      const result = await runOnce("manual");

      const { sendError } = await import("./bot/notifier.js");
      expect(sendError).not.toHaveBeenCalled();
      await expect(
        mocks.runWithStorageMock.mock.results[0].value,
      ).resolves.toMatchObject({
        report: { failed: false },
      });
      expect(result).toMatchObject({ trigger: "manual", failed: false });
      expect(runner.getLastRun()).toBe(result);
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(false, [{}], false);
      const { logRunMetadata } = await import("./runnerMetadata.js");
      expect(logRunMetadata).toHaveBeenCalledWith(
        { node: { main: ["GET parent.test"] } },
        domains,
      );
    });

    it("fails the run when an account fails to scrape", async () => {
      mocks.scrapeAccountsMock.mockResolvedValue({
        results: [
          accountResult(CompanyTypes.hapoalim, true),
          accountResult(CompanyTypes.oneZero, false),
        ],
        domains: {},
      });

      expect(await runOnce("manual")).toMatchObject({ failed: true });
    });

    it("fails the run when a storage reports an error", async () => {
      const report = createRunReport();
      report.storages.sql = { state: "error", message: "boom" };
      mocks.runWithStorageMock.mockImplementation(async (runScraper) => {
        await runScraper(hooks());
        return { report, reportSent: false };
      });

      expect(await runOnce("manual")).toMatchObject({ failed: true });
    });

    it("fails the run when the report records an error", async () => {
      const report = createRunReport();
      report.failed = true;
      mocks.runWithStorageMock.mockResolvedValue({ report, reportSent: false });

      expect(await runOnce("manual")).toMatchObject({ failed: true });
    });

    it("fails the run when scraping throws", async () => {
      mocks.scrapeAccountsMock.mockRejectedValue(new Error("scraping failed"));

      expect(await runOnce("manual")).toMatchObject({ failed: true });
    });

    it("preserves an error callback failure even when accounts succeed", async () => {
      mocks.scrapeAccountsMock.mockImplementation(
        async (_config, _requestOtp, _status, onError) => {
          await onError?.(new Error("browser close failed"), "browser.close");
          return {
            results: [accountResult(CompanyTypes.hapoalim, true)],
            domains: {},
          };
        },
      );

      expect(await runOnce("manual")).toMatchObject({ failed: true });
    });

    it("fails the run when the storage wrapper throws", async () => {
      mocks.runWithStorageMock.mockRejectedValue(new Error("exploded"));

      expect(await runOnce("manual")).toMatchObject({ failed: true });
    });

    it("delivers logs without storage clients when storage construction fails and permits retry", async () => {
      const { createStorages } = await import("./bot/storage/index.js");
      jest.mocked(createStorages).mockImplementationOnce(() => {
        throw new Error("storage setup failed");
      });

      expect(await runOnce("manual")).toMatchObject({ failed: true });
      expect(mocks.scrapeAccountsMock).not.toHaveBeenCalled();
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(false, [], false);
      expect(await runOnce("manual")).toMatchObject({ failed: false });
    });

    it("retains the run's storage clients for logs when tracker construction fails", async () => {
      const { createDomainTracker } = await import("./security/domains.js");
      const { createStorages } = await import("./bot/storage/index.js");
      jest.mocked(createDomainTracker).mockImplementationOnce(() => {
        throw new Error("tracker setup failed");
      });

      expect(await runOnce("manual")).toMatchObject({ failed: true });
      expect(mocks.scrapeAccountsMock).not.toHaveBeenCalled();
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(
        false,
        jest.mocked(createStorages).mock.results[0].value,
        false,
      );
    });

    it("finishes tracking before log delivery, retaining the clients when tracker cleanup fails", async () => {
      const { createDomainTracker } = await import("./security/domains.js");
      const { createStorages } = await import("./bot/storage/index.js");
      const dispose = jest.fn(() => {
        throw new Error("tracker cleanup failed");
      });
      const tracker = mock<ReturnType<typeof createDomainTracker>>();
      tracker.dispose.mockImplementation(dispose);
      tracker.getUsedDomains.mockResolvedValue({});
      jest.mocked(createDomainTracker).mockReturnValueOnce(tracker);
      mocks.runWithStorageMock.mockRejectedValueOnce(
        new Error("storage operation failed"),
      );

      expect(await runOnce("manual")).toMatchObject({ failed: true });
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(
        false,
        jest.mocked(createStorages).mock.results[0].value,
        false,
      );
      expect(dispose.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.sendLogFileMock.mock.invocationCallOrder[0],
      );
      expect(await runner.isRunning()).toBe(false);
    });

    it("does not carry a failure over to the next run", async () => {
      mocks.runWithStorageMock.mockRejectedValueOnce(new Error("exploded"));
      await runOnce("manual");

      expect(await runOnce("manual")).toMatchObject({ failed: false });
    });

    it("hands the run back before it finishes, so a caller can answer honestly", async () => {
      let releaseRun!: () => void;
      mocks.runWithStorageMock.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
        return { report: createRunReport(), reportSent: false };
      });

      const handle = await runner.startRun("manual");

      expect(handle.started).toBe(true);
      expect(await runner.isRunning()).toBe(true);

      releaseRun();
      await expect(handle.finished).resolves.toMatchObject({ failed: false });
    });

    it("reports a second run while one is in flight as not started", async () => {
      let releaseRun!: () => void;
      const runIsHolding = new Promise<void>((resolve) => {
        releaseRun = resolve;
      });
      mocks.runWithStorageMock.mockImplementation(async (runScraper) => {
        await runScraper(hooks());
        await runIsHolding;
        return { report: createRunReport(), reportSent: false };
      });

      const first = runOnce("manual");
      await new Promise((resolve) => setImmediate(resolve));

      expect(await runner.isRunning()).toBe(true);
      expect((await runner.startRun("manual")).started).toBe(false);

      releaseRun();
      await expect(first).resolves.toMatchObject({ failed: false });
      expect(await runner.isRunning()).toBe(false);
    });

    it("shares one run id between the storages and the log upload", async () => {
      const runIds: Array<string | undefined> = [];
      const recordRunId = () =>
        runIds.push(mocks.runContextStore.getStore()?.runId);
      mocks.runWithStorageMock.mockImplementation(async () => {
        recordRunId();
        return { report: createRunReport(), reportSent: false };
      });
      mocks.sendLogFileMock.mockImplementation(async () => {
        recordRunId();
      });

      await runOnce("manual");
      await runOnce("manual");

      expect(runIds).toHaveLength(4);
      expect(runIds[0]).toEqual(expect.any(String));
      expect(runIds[1]).toBe(runIds[0]);
      expect(runIds[2]).toBe(runIds[3]);
      expect(runIds[2]).not.toBe(runIds[0]);
    });

    it("releases the lock when the log upload fails", async () => {
      mocks.sendLogFileMock.mockRejectedValueOnce(new Error("boom"));

      const handle = await runner.startRun("manual");
      await expect(handle.finished).rejects.toThrow("boom");
      expect(await runner.isRunning()).toBe(false);
    });
  });
});
