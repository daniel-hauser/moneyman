import { readFile } from "node:fs/promises";
import { postJson, readSecretFile } from "@moneyman/common";
import {
  OkResponseSchema,
  OtpResponseSchema,
  TelegramMessageResponseSchema,
  type ImagePayload,
} from "@moneyman/protocol";
import { config } from "./config.js";
import type { ImageWithCaption } from "./types.js";

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

export async function requestOtpCode(companyId: string, phoneNumber: string) {
  const response = await postJson(
    config.services.notifierUrl,
    "/v1/otp/request",
    notifierToken,
    { companyId, phoneNumber },
    OtpResponseSchema,
  );
  return response.code;
}

export async function sendPhotos(photos: ImageWithCaption[]) {
  const images: ImagePayload[] = await Promise.all(
    photos.map(async ({ photoPath, caption }) => ({
      caption,
      contentBase64: (await readFile(photoPath)).toString("base64"),
    })),
  );

  return postJson(
    config.services.notifierUrl,
    "/v1/images",
    notifierToken,
    { images },
    OkResponseSchema,
  );
}

export function uploadPrivateLog(content: string, captured: boolean) {
  return postJson(
    config.services.notifierUrl,
    "/v1/logs",
    notifierToken,
    { source: "scraper", captured, content },
    OkResponseSchema,
  );
}
