import { createServer, type IncomingMessage } from "node:http";
import {
  HttpError,
  createLogger,
  enableDebugLogging,
  readJsonBody,
  readSecretFile,
  requireBearerToken,
  sendJson,
} from "@moneyman/common";
import {
  ImagePayloadSchema,
  LogUploadSchema,
  OtpRequestSchema,
  TelegramEditSchema,
  TelegramImagesSchema,
  TelegramMessageSchema,
} from "@moneyman/protocol";
import z from "zod/v4";
import { config } from "./config.js";
import { finalizeLogs, receiveLog } from "./logging.js";
import {
  editMessage,
  requestOtpCode,
  send,
  sendImages,
  sendJson as sendTelegramJson,
} from "./notifier.js";

const logger = createLogger("main");
const scraperToken = readSecretFile("MONEYMAN_SCRAPER_TOKEN_PATH");
const exporterToken = readSecretFile("MONEYMAN_EXPORTER_TOKEN_PATH");

enableDebugLogging(config.logging.debugFilter);

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method !== "POST") {
      throw new HttpError(404, "Not found");
    }

    const caller = authorize(request);
    const body = await readJsonBody(request, 25_000_000);

    switch (request.url) {
      case "/v1/messages": {
        const payload = TelegramMessageSchema.parse(body);
        sendJson(response, 200, await send(payload.message, payload.parseMode));
        return;
      }
      case "/v1/messages/edit": {
        const payload = TelegramEditSchema.parse(body);
        await editMessage(
          payload.messageId,
          payload.message,
          payload.parseMode,
        );
        break;
      }
      case "/v1/images": {
        if (caller !== "scraper") {
          throw new HttpError(403, "Only scraper may upload images");
        }
        const payload = TelegramImagesSchema.parse(body);
        await sendImages(payload.images);
        break;
      }
      case "/v1/documents/json": {
        if (caller !== "exporter") {
          throw new HttpError(403, "Only exporter may send documents");
        }
        const payload = z
          .strictObject({
            json: z.unknown(),
            filename: z.string().min(1).max(256),
          })
          .parse(body);
        await sendTelegramJson(payload.json, payload.filename);
        break;
      }
      case "/v1/otp/request": {
        if (caller !== "scraper") {
          throw new HttpError(403, "Only scraper may request OTP");
        }
        const payload = OtpRequestSchema.parse(body);
        sendJson(response, 200, {
          code: await requestOtpCode(payload.companyId, payload.phoneNumber),
        });
        return;
      }
      case "/v1/logs": {
        const payload = LogUploadSchema.parse(body);
        if (payload.source !== caller) {
          throw new HttpError(403, "Log source does not match caller");
        }
        const complete = receiveLog(
          payload.source,
          payload.content,
          payload.captured,
        );
        sendJson(response, 200, { ok: true });
        if (complete) {
          setImmediate(async () => {
            try {
              await finalizeLogs();
            } finally {
              server.close();
            }
          });
        }
        return;
      }
      default:
        throw new HttpError(404, "Not found");
    }

    sendJson(response, 200, { ok: true });
  } catch (error) {
    logger("Notifier request failed", error);
    sendJson(response, error instanceof HttpError ? error.statusCode : 500, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

server.listen(config.listenPort, "0.0.0.0", async () => {
  if (config.legacyConfigNotice) {
    await send(
      "Moneyman loaded the legacy monolithic configuration. It was split into least-privilege service files for this run; migrate to service-specific configuration when convenient.",
    );
  }
});

function authorize(request: IncomingMessage): "scraper" | "exporter" {
  try {
    requireBearerToken(request, scraperToken);
    return "scraper";
  } catch {
    requireBearerToken(request, exporterToken);
    return "exporter";
  }
}
