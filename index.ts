import { createLogger } from "./src/utils/logger.js";

const logger = createLogger("main");

// Check if we should run in separated mode
const separatedMode = process.env.SEPARATED_MODE === 'true';

if (separatedMode) {
  // In separated mode, this process acts as the storage service
  logger("Starting in separated mode - running storage service");
  import("./storage-service/index.js");
} else {
  // In unified mode, run the original code
  logger("Starting in unified mode");
  import("./src/index.js");
}