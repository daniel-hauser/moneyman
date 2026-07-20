import { existsSync, readFileSync } from "node:fs";
import {
  createLogger,
  enableDebugLogging,
  postJson,
  readSecretFile,
  unsafeStdout,
} from "@moneyman/common";
import { OkResponseSchema, ScrapePayloadSchema } from "@moneyman/protocol";
import { config, scraperConfig } from "./config.js";
import { sendFailureScreenShots } from "./failureScreenshot.js";
import { scrapeAccounts } from "./index.js";
import { getSummaryMessages } from "./messages.js";
import { resultsToPayload } from "./payload.js";
import {
  editMessage,
  send,
  sendError,
  sendPhotos,
  uploadPrivateLog,
} from "./notifier.js";
import { getExternalIp, logRunMetadata } from "./runnerMetadata.js";
import { monitorNodeConnections } from "./security/domains.js";

const logger = createLogger("main");
const exporterToken = readSecretFile("MONEYMAN_EXPORTER_TOKEN_PATH");

enableDebugLogging(config.options.logging.debugFilter);
monitorNodeConnections();

try {
  await run();
} catch (error) {
  logger("Scraper failed", error);
  await sendError(error, "scraper");
  process.exitCode = 1;
} finally {
  await uploadLog();
}
process.exit(process.exitCode ?? 0);

async function run() {
  const statusMessage = await send("Starting...");
  logger("External IP info:", await getExternalIp());

  const results = await scrapeAccounts(
    scraperConfig,
    async (status, totalTime) => {
      const text = status.join("\n");
      await editMessage(
        statusMessage.messageId,
        totalTime
          ? `${text}\n\nTotal time: ${totalTime.toFixed(1)} seconds`
          : text,
      );
    },
    async (error, caller) => {
      await sendError(error, caller);
    },
  );

  await Promise.all([
    send(getSummaryMessages(results), "HTML"),
    sendFailureScreenShots(sendPhotos),
  ]);

  const payload = ScrapePayloadSchema.parse(
    await resultsToPayload(results, sendError),
  );
  await postJson(
    config.services.exporterUrl,
    "/v1/scrapes",
    exporterToken,
    payload,
    OkResponseSchema,
    60 * 60_000,
  );
  await logRunMetadata();
}

async function uploadLog() {
  const logPath = process.env.MONEYMAN_PRIVATE_LOG_PATH;
  const content =
    logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  await uploadPrivateLog(content, !unsafeStdout);
}
