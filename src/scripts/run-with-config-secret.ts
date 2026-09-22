#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createConfigSecretProcessEnvironment } from "../configSecret.js";

const safePublicError =
  "Moneyman failed before completion. Sensitive error details were withheld from public logs.";

function reportSafePublicError() {
  if (process.env.MONEYMAN_UNSAFE_STDOUT !== "false") {
    return;
  }

  const publicLogFd = Number(process.env.MONEYMAN_PUBLIC_LOG_FD);
  if (Number.isInteger(publicLogFd) && publicLogFd >= 0) {
    try {
      writeSync(publicLogFd, `${safePublicError}\n`);
      return;
    } catch {
      // Fall through to redirected stderr.
    }
  }

  console.error(safePublicError);
}

const command = process.argv.slice(2);
const configSecret = process.env.MONEYMAN_CONFIG_SECRET;

if (!configSecret) {
  console.error("MONEYMAN_CONFIG_SECRET is required");
  reportSafePublicError();
  process.exit(1);
}

if (command.length === 0) {
  console.error("A command is required");
  reportSafePublicError();
  process.exit(1);
}

let environment: NodeJS.ProcessEnv;
try {
  environment = createConfigSecretProcessEnvironment(configSecret);
} catch (error) {
  console.error("Unable to configure secret provider:", error);
  reportSafePublicError();
  process.exit(1);
}

const varlockCli = fileURLToPath(
  new URL("../../node_modules/varlock/bin/cli.js", import.meta.url),
);
const child = spawn(process.execPath, [varlockCli, "run", "--", ...command], {
  env: environment,
  stdio: "inherit",
});

const forwardedSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
for (const signal of forwardedSignals) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error("Unable to start Varlock:", error.message);
  reportSafePublicError();
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }

  const exitCode = code ?? 1;
  if (exitCode !== 0) {
    reportSafePublicError();
  }
  process.exit(exitCode);
});
