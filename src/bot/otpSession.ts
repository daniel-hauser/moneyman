import { createLogger } from "../utils/logger.js";
import { formatUnknownError } from "../utils/utils.js";
import {
  launchTelegramBot,
  requestOtpCode,
  send,
  stopTelegramBot,
} from "./notifier.js";
import type { OtpRequest } from "../scraper/otp.js";

const logger = createLogger("otp");

export function createOneShotOtpSession(signal?: AbortSignal) {
  let polling: Promise<void> | undefined;

  function startPolling() {
    if (polling) return polling;
    const launched = launchTelegramBot().catch((error: unknown) => {
      if (polling === launched) polling = undefined;
      logger("Failed to start Telegram bot for OTP", error);
      void send(
        `requestOtpCode\n❌ ${
          error instanceof Error
            ? `${error.message}\n${error.stack}`
            : formatUnknownError(error)
        }`,
      ).catch((notificationError: unknown) =>
        logger("Failed to send OTP error notification", notificationError),
      );
      throw new Error(`Failed to start Telegram bot for OTP: ${error}`);
    });
    polling = launched;
    return polling;
  }

  const request: OtpRequest = async (companyId, phoneNumber, requestSignal) => {
    signal?.throwIfAborted();
    requestSignal?.throwIfAborted();

    const completed = new AbortController();
    const combined = AbortSignal.any(
      [signal, requestSignal, completed.signal].filter(
        (signal) => signal !== undefined,
      ),
    );
    try {
      const lifetime = startPolling().then(() => {
        throw new Error("Telegram bot stopped while waiting for OTP");
      });
      const response = requestOtpCode(companyId, phoneNumber, combined);
      return await Promise.race([response, lifetime]);
    } finally {
      completed.abort();
    }
  };

  return {
    request,
    async close() {
      const completed = new AbortController();
      const shutdown = AbortSignal.any([
        AbortSignal.timeout(3_000),
        completed.signal,
      ]);
      try {
        await stopTelegramBot(shutdown);
      } finally {
        completed.abort();
      }
    },
  };
}
