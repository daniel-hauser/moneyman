import type { TransactionStorage } from "./types.js";
import { sendStorageLogs } from "./storageLogs.js";

function storage(sendLogs?: (logs: string) => Promise<void>) {
  return {
    canSave: () => true,
    saveTransactions: jest.fn(),
    sendLogs,
  } as TransactionStorage;
}

describe("sendStorageLogs", () => {
  it("sends captured logs only to supporting storages", async () => {
    const first = jest.fn().mockResolvedValue(undefined);
    const second = jest.fn().mockResolvedValue(undefined);

    await sendStorageLogs(
      [storage(first), storage(), storage(second)],
      "private logs",
    );

    expect(first).toHaveBeenCalledWith("private logs");
    expect(second).toHaveBeenCalledWith("private logs");
  });

  it("lets other storage uploads finish when one rejects", async () => {
    const failed = jest.fn().mockRejectedValue(new Error("unavailable"));
    const succeeded = jest.fn().mockResolvedValue(undefined);

    await expect(
      sendStorageLogs([storage(failed), storage(succeeded)], "private logs"),
    ).resolves.toBeUndefined();
    expect(succeeded).toHaveBeenCalledWith("private logs");
  });
});
