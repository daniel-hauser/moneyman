import { sendError } from "./bot/notifier.js";
import { initRunner, runOnce } from "./runner.js";

console.log("Starting...");

process.on("uncaughtException", (err, origin) => {
  console.error("uncaughtException, sending error");
  sendError(`
    Caught exception: ${err}
    err.stack: ${err.stack}
    Exception origin: ${origin}`).catch((e) => {});
});

await initRunner();
await runOnce("startup");

// kill internal browsers if stuck
process.exit(0);
