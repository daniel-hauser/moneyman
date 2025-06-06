import { saveResults, storages } from "../src/bot/storage/index.js";
import { AccountScrapeResult } from "../src/types.js";
import { createLogger, logToPublicLog } from "../src/utils/logger.js";
import { getSummaryMessages } from "../src/bot/messages.js";
import {
  editMessage,
  send,
  sendError,
  sendJSON,
  sendPhotos,
} from "../src/bot/notifier.js";
import * as zmq from "zeromq";

const logger = createLogger("storage-service");

// ZeroMQ socket for receiving messages from scraper service
const receiver = new zmq.Pull();

interface ScraperMessage {
  type: 'results' | 'error' | 'status' | 'metadata' | 'screenshots' | 'finished';
  data: any;
}

let currentMessage: any = null;

async function handleScraperMessage(message: ScraperMessage): Promise<void> {
  try {
    switch (message.type) {
      case 'status':
        if (Array.isArray(message.data)) {
          // Initial status message
          const text = message.data.join("\n");
          currentMessage = await send("Starting...");
          await editMessage(currentMessage?.message_id, text);
        } else if (message.data.status && message.data.totalTime !== undefined) {
          // Status update with timing
          const text = message.data.status.join("\n");
          await editMessage(
            currentMessage?.message_id,
            message.data.totalTime
              ? text + `\n\nTotal time: ${message.data.totalTime.toFixed(1)} seconds`
              : text,
          );
        }
        break;

      case 'results':
        logger("Received scraping results");
        const results = message.data as AccountScrapeResult[];
        await send(getSummaryMessages(results));
        await saveResults(results);
        break;

      case 'error':
        logger("Received error from scraper");
        const error = new Error(message.data.message);
        if (message.data.stack) {
          error.stack = message.data.stack;
        }
        await sendError(error, message.data.caller || "scraper");
        break;

      case 'screenshots':
        logger("Received failure screenshots");
        await sendPhotos(message.data);
        break;

      case 'metadata':
        logger("Received run metadata");
        await sendJSON(message.data, "run-metadata.txt");
        break;

      case 'finished':
        logger("Scraper finished, storage service shutting down");
        logToPublicLog("Scraping ended");
        setTimeout(() => process.exit(0), 1000); // Give a moment for final processing
        break;

      default:
        logger("Unknown message type:", message.type);
    }
  } catch (error) {
    logger("Error handling message", error);
  }
}

async function main() {
  try {
    // Check if we have any storages configured
    if (!storages.length) {
      logger("No storages found, aborting");
      await send("No storages found, aborting");
      return;
    }

    // Bind to receive messages from scraper
    const endpoint = process.env.STORAGE_ENDPOINT || "tcp://127.0.0.1:5555";
    await receiver.bind(endpoint);
    logger(`Storage service listening on ${endpoint}`);

    // Listen for messages from scraper
    for await (const [msg] of receiver) {
      try {
        const message: ScraperMessage = JSON.parse(msg.toString());
        logger("Received message", message.type);
        await handleScraperMessage(message);
      } catch (error) {
        logger("Error parsing message", error);
      }
    }
  } catch (error) {
    logger("Error in storage service", error);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger("Shutting down storage service...");
  await receiver.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger("Shutting down storage service...");
  await receiver.close();
  process.exit(0);
});

main().catch((error) => {
  console.error("Fatal error in storage service:", error);
  process.exit(1);
});