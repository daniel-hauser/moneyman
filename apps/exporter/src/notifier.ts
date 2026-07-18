import { postJson, readSecretFile } from "@moneyman/common";
import {
  OkResponseSchema,
  TelegramMessageResponseSchema,
} from "@moneyman/protocol";
import { config } from "./config.js";

const notifierToken = readSecretFile("MONEYMAN_NOTIFIER_TOKEN_PATH");

export function send(message: string, parseMode?: "HTML") {
  return postJson(
    config.services.notifierUrl,
    "/v1/messages",
    notifierToken,
    { message, parseMode },
    TelegramMessageResponseSchema,
  );
}

export function editMessage(
  messageId: number | undefined,
  message: string,
  parseMode?: "HTML",
) {
  return postJson(
    config.services.notifierUrl,
    "/v1/messages/edit",
    notifierToken,
    { messageId, message, parseMode },
    OkResponseSchema,
  );
}

export function sendError(error: unknown, caller = "") {
  const message =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error);
  return send(`${caller}\nERROR: ${message}`.trim());
}

export function sendJson(json: unknown, filename: string) {
  return postJson(
    config.services.notifierUrl,
    "/v1/documents/json",
    notifierToken,
    { json, filename },
    OkResponseSchema,
  );
}

export function uploadPrivateLog(content: string, captured: boolean) {
  return postJson(
    config.services.notifierUrl,
    "/v1/logs",
    notifierToken,
    { source: "exporter", captured, content },
    OkResponseSchema,
  );
}
