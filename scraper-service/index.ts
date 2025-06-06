import { scrapeAccounts } from "../src/scraper/index.js";
import { scraperConfig } from "../src/config.js";
import { createLogger } from "../src/utils/logger.js";
import { monitorNodeConnections } from "../src/security/domains.js";
import { reportRunMetadata } from "../src/runnerMetadata.js";
import { sendFailureScreenShots } from "../src/utils/failureScreenshot.js";
import * as zmq from "zeromq";

const logger = createLogger("scraper-service");

// ZeroMQ socket for sending results to storage service
const sender = new zmq.Push();

interface ScraperMessage {
  type: 'results' | 'error' | 'status' | 'metadata' | 'screenshots' | 'finished';
  data: any;
}

process.on("uncaughtException", (err, origin) => {
  console.error("uncaughtException in scraper service", err);
  sendMessage({
    type: 'error',
    data: {
      message: `Caught exception: ${err}`,
      stack: err.stack,
      origin
    }
  }).catch(() => {});
});

async function sendMessage(message: ScraperMessage): Promise<void> {
  try {
    await sender.send(JSON.stringify(message));
    logger(`Sent message: ${message.type}`);
  } catch (e) {
    logger("Failed to send message", e);
  }
}

async function main() {
  try {
    // Connect to storage service
    const storageEndpoint = process.env.STORAGE_ENDPOINT || "tcp://127.0.0.1:5555";
    await sender.connect(storageEndpoint);
    logger(`Connected to storage at ${storageEndpoint}`);

    // Start monitoring
    monitorNodeConnections();

    logger("Starting scraper service");
    
    // Send initial status
    await sendMessage({
      type: 'status',
      data: ['Starting scraper...']
    });

    const results = await scrapeAccounts(
      scraperConfig,
      async (status, totalTime) => {
        logger("Status changed", { status, totalTime });
        await sendMessage({
          type: 'status', 
          data: { status, totalTime }
        });
      },
      async (e, caller) => {
        logger("Error while scraping", e);
        await sendMessage({
          type: 'error',
          data: { error: e.message, stack: e.stack, caller }
        });
      },
    );

    logger("Scraping completed, sending results");
    await sendMessage({
      type: 'results',
      data: results
    });

    // Send failure screenshots if any
    await sendFailureScreenShots(async (photos) => {
      await sendMessage({
        type: 'screenshots',
        data: photos
      });
    });

    // Send run metadata
    await reportRunMetadata(async (metadata) => {
      logger("Reporting run metadata", metadata);
      await sendMessage({
        type: 'metadata',
        data: metadata
      });
    });

    // Signal completion
    await sendMessage({
      type: 'finished',
      data: null
    });

    logger("Scraper service finished successfully");

  } catch (error) {
    logger("Error in scraper service", error);
    await sendMessage({
      type: 'error',
      data: { 
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }
    });
  } finally {
    // Clean up
    await sender.close();
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Fatal error in scraper service:", error);
  process.exit(1);
});