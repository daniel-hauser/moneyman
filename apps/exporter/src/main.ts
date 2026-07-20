import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  HttpError,
  createLogger,
  enableDebugLogging,
  readJsonBody,
  readSecretFile,
  requireBearerToken,
  runContextStore,
  sendJson,
  unsafeStdout,
} from "@moneyman/common";
import { ScrapePayloadSchema } from "@moneyman/protocol";
import { config } from "./config.js";
import { assignDeprecationHandler } from "./deprecationManager.js";
import { send, sendError, uploadPrivateLog } from "./notifier.js";
import { savePayload } from "./storage/index.js";
import { sendStorageLogs } from "./storageLogs.js";

const logger = createLogger("main");
const scraperToken = readSecretFile("MONEYMAN_SCRAPER_TOKEN_PATH");
const listenPort = Number.parseInt(
  process.env.MONEYMAN_EXPORTER_PORT ?? "3002",
  10,
);
let handledRequest = false;
const pendingDeprecationMessages: string[] = [];

enableDebugLogging(config.options.logging.debugFilter);
assignDeprecationHandler((messageId, message) => {
  if (!config.options.scraping.hiddenDeprecations.includes(messageId)) {
    pendingDeprecationMessages.push(message);
  }
});

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (
      request.method !== "POST" ||
      request.url !== "/v1/scrapes" ||
      handledRequest
    ) {
      throw new HttpError(404, "Not found");
    }

    requireBearerToken(request, scraperToken);
    const payload = ScrapePayloadSchema.parse(
      await readJsonBody(request, 100_000_000),
    );
    handledRequest = true;
    await runContextStore.run({ runId: randomUUID() }, async () => {
      const storages = await savePayload(payload);
      await flushDeprecationMessages();
      await uploadLogs(storages);
    });
    sendJson(response, 200, { ok: true });
    server.close();
  } catch (error) {
    logger("Exporter request failed", error);
    await sendError(error, "exporter");
    sendJson(response, error instanceof HttpError ? error.statusCode : 500, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

server.listen(listenPort, "0.0.0.0");

async function flushDeprecationMessages() {
  const messages = pendingDeprecationMessages.splice(0);
  const results = await Promise.allSettled(
    messages.map((message) => send(message)),
  );
  results.forEach((result) => {
    if (result.status === "rejected") {
      logger("Failed to send a deprecation warning", result.reason);
    }
  });
}

async function uploadLogs(storages: Awaited<ReturnType<typeof savePayload>>) {
  const logPath = process.env.MONEYMAN_PRIVATE_LOG_PATH;
  const captured = Boolean(!unsafeStdout && logPath && existsSync(logPath));
  const content =
    logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  await Promise.all([
    captured ? sendStorageLogs(storages, content) : Promise.resolve(),
    uploadPrivateLog(content, captured),
  ]);
}
