import "dotenv/config";
import { readFileSync } from "node:fs";
import type { ZodType } from "zod/v4";
import { parseJsoncConfig } from "./jsonc.js";
import { createLogger } from "./logger.js";

const logger = createLogger("config");

export interface ConfigSource {
  inlineEnvironmentVariable: string;
  pathEnvironmentVariable: string;
}

export function loadConfig<T>(
  schema: ZodType<T>,
  { inlineEnvironmentVariable, pathEnvironmentVariable }: ConfigSource,
): T {
  const inlineConfig = process.env[inlineEnvironmentVariable];
  if (inlineConfig) {
    logger(`Using ${inlineEnvironmentVariable}`);
    return schema.parse(parseJsoncConfig(inlineConfig));
  }

  const configPath = process.env[pathEnvironmentVariable];
  if (configPath) {
    logger(`Using ${pathEnvironmentVariable}`);
    const configFileContent = readFileSync(configPath, "utf8");
    return schema.parse(parseJsoncConfig(configFileContent));
  }

  throw new Error(
    `No configuration found. Provide ${inlineEnvironmentVariable} or ${pathEnvironmentVariable}.`,
  );
}

export function readSecretFile(environmentVariable: string): string {
  const secretPath = process.env[environmentVariable];
  if (!secretPath) {
    throw new Error(`${environmentVariable} is required`);
  }

  return readFileSync(secretPath, "utf8").trim();
}
