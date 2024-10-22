import { parallelScrapers } from "../config.js";
import * as os from "os";
import { saveResults, storages } from "./storage/index.js";
import { AccountScrapeResult, Runner } from "../types.js";
import { sendFailureScreenShots } from "../utils/failureScreenshot.js";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import { getSummaryMessages } from "./messages.js";
import { editMessage, send, sendError } from "./notifier.js";

const logger = createLogger("bot");

export async function runWithStorage(runScraper: Runner) {
    const message = await send("Starting...");
    if (!storages.length) {
        logger("No storages found, aborting");
        await editMessage(message?.message_id, "No storages found, aborting");
        return;
    }

    await runScraper(
        {
            async onStatusChanged(
                status: Array<string>,
                totalTime?: number,
            ) {
                const text = status.join("\n");
                await editMessage(
                    message?.message_id,
                    totalTime
                        ? text +
                            `\n\nTotal time: ${totalTime.toFixed(1)} seconds`
                        : text,
                );
            },
            async onResultsReady(results: AccountScrapeResult[]) {
                await send(getSummaryMessages(results));
                await saveResults(results);
                await sendFailureScreenShots();
            },
            async onError(e: Error, caller: string = "unknown") {
                await sendError(e, caller);
            },
            async onBeforeStart() {
                if (parallelScrapers > 1) {
                    logger(
                        `Running with ${parallelScrapers} parallel scrapers`,
                    );
                    send(
                        `System info: ${
                            JSON.stringify(
                                {
                                    parallelScrapers: Number(parallelScrapers),
                                    availableParallelism: os
                                        .availableParallelism(),
                                    totalMemoryGB: (os.totalmem() / 1000000000)
                                        .toFixed(2),
                                    freeMemoryGB: (os.freemem() / 1000000000)
                                        .toFixed(2),
                                    cpus: os.cpus().length,
                                },
                                null,
                                2,
                            )
                        }`,
                    );
                }
            },
        },
    );

    logger("Scraping ended");
    logToPublicLog("Scraping ended");
}
