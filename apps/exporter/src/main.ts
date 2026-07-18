import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import {
  HttpError,
  createLogger,
  enableDebugLogging,
  readJsonBody,
  readSecretFile,
  requireBearerToken,
  sendJson,
  unsafeStdout,
} from "@moneyman/common";
import { ScrapePayloadSchema } from "@moneyman/protocol";
import { config } from "./config.js";
import { sendError, uploadPrivateLog } from "./notifier.js";
import { savePayload } from "./storage/index.js";

const logger = createLogger("main");
const scraperToken = readSecretFile("MONEYMAN_SCRAPER_TOKEN_PATH");
const listenPort = Number.parseInt(
  process.env.MONEYMAN_EXPORTER_PORT ?? "3002",
  10,
);
let handledRequest = false;

enableDebugLogging(config.options.logging.debugFilter);

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
    await savePayload(payload);
    await uploadLog();
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

async function uploadLog() {
  const logPath = process.env.MONEYMAN_PRIVATE_LOG_PATH;
  const content =
    logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  await uploadPrivateLog(content, !unsafeStdout);
}
