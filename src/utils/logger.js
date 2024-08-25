// utils/logger.js
import debug from "debug";

// Create a logger instance
export const logger = debug("moneyman");

// Export the createLogger function
export function createLogger(name) {
  return logger.extend(name);
}

// Export the logToPublicLog function
export function logToPublicLog(message) {
  console.log(message);
}
