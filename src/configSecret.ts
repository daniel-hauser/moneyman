import { z } from "zod";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MoneymanConfigSchema } from "./config.schema.js";
import { workerEnvironment } from "./scraper/environment.js";
import { parseJsoncConfig } from "./utils/jsonc.js";
import { createLogger, logToPublicLog, unsafeStdout } from "./utils/logger.js";

const logger = createLogger("secrets");

const ConfigSecretSchema = z.discriminatedUnion("provider", [
  z.strictObject({
    provider: z.literal("bitwarden"),
    secretId: z.uuid(),
    accessToken: z.string().min(1),
  }),
]);

export function getConfigSecretEnvironment(
  configSecret: unknown,
): NodeJS.ProcessEnv {
  const descriptor = ConfigSecretSchema.parse(
    typeof configSecret === "string"
      ? parseJsoncConfig(configSecret)
      : configSecret,
  );

  switch (descriptor.provider) {
    case "bitwarden":
      return {
        BITWARDEN_ACCESS_TOKEN: descriptor.accessToken,
        MONEYMAN_CONFIG_SECRET_ID: descriptor.secretId,
      };
  }
}

function configSecretCommand(configSecret: unknown) {
  const environment = getConfigSecretEnvironment(configSecret);
  return {
    args: [
      fileURLToPath(
        new URL("../node_modules/varlock/bin/cli.js", import.meta.url),
      ),
      "load",
      "--format",
      "json",
      "--filter",
      "MONEYMAN_CONFIG",
      "--path",
      fileURLToPath(new URL("../.env.schema", import.meta.url)),
      "--skip-cache",
    ],
    options: {
      env: {
        ...workerEnvironment(process.env),
        VARLOCK_TELEMETRY_DISABLED: "1",
        BITWARDEN_ACCESS_TOKEN: environment.BITWARDEN_ACCESS_TOKEN,
        MONEYMAN_CONFIG_SECRET_ID: environment.MONEYMAN_CONFIG_SECRET_ID,
      },
      encoding: "utf8" as const,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
      // A child handling SIGTERM must not keep startup or a refresh blocked.
      killSignal: "SIGKILL" as const,
    },
  };
}

function parseConfigSecret(stdout: string) {
  const output = JSON.parse(stdout) as Record<string, unknown>;
  const value = output.MONEYMAN_CONFIG;
  if (typeof value !== "string" || !value) {
    throw new Error("Provider returned no configuration");
  }
  return MoneymanConfigSchema.parse(parseJsoncConfig(value));
}

// Config is eagerly imported by application and script entrypoints.
export function loadConfigSecretSync(configSecret: unknown) {
  try {
    const { args, options } = configSecretCommand(configSecret);
    return parseConfigSecret(execFileSync(process.execPath, args, options));
  } catch (error) {
    console.error("Unable to load configuration from secret provider:", error);
    const message =
      "Moneyman failed before completion. Sensitive error details were withheld from public logs.";
    if (!unsafeStdout) logToPublicLog(message);
    throw new Error(message);
  }
}

export async function loadConfigSecret(configSecret: unknown) {
  const { args, options } = configSecretCommand(configSecret);
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(process.execPath, args, options, (error, stdout, stderr) => {
    if (error) {
      logger("Varlock secret load failed", error, stderr);
      reject(error);
    } else {
      resolve(stdout);
    }
  });
  return parseConfigSecret(await promise);
}
