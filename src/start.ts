import { longRunning } from "./utils/env.js";

/**
 * The entry point the container runs. Which mode to start is decided here, in
 * the app, instead of in the shell: the long running server and the one shot
 * runner each know their own mode, so no other component has to agree with an
 * environment variable for the logs to be handled correctly.
 */
function handleStartupFailure(error: unknown) {
  console.error("Failed to start moneyman", error);
  process.exitCode = 1;
}

if (longRunning) {
  void import("./server.js").catch(handleStartupFailure);
} else {
  void import("./index.js").catch(handleStartupFailure);
}
