import { createLogger } from "@moneyman/common";
import type { TransactionStorage } from "./types.js";

const logger = createLogger("storage-logs");

export async function sendStorageLogs(
  storages: TransactionStorage[],
  logs: string,
) {
  const logStorages = storages.filter(
    (
      storage,
    ): storage is TransactionStorage & {
      sendLogs(logs: string): Promise<void>;
    } => typeof storage.sendLogs === "function",
  );
  const results = await Promise.allSettled(
    logStorages.map((storage) => storage.sendLogs(logs)),
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger(
        `Failed to send logs to ${logStorages[index].constructor.name}`,
        result.reason,
      );
    }
  });
}
