#!/usr/bin/env node
import "dotenv/config";
import { readFileSync } from "node:fs";
import { MoneymanConfigSchema } from "../config.schema.js";
import { parseJsoncConfig } from "../utils/jsonc.js";
import { loadConfigSecretSync } from "../configSecret.js";

try {
  console.log("🔍 Verifying config parsing...");
  const { MONEYMAN_CONFIG_SECRET, MONEYMAN_CONFIG, MONEYMAN_CONFIG_PATH } =
    process.env;
  if (MONEYMAN_CONFIG_SECRET) {
    loadConfigSecretSync(MONEYMAN_CONFIG_SECRET);
    console.log("✅ Config parsing successful");
  } else if (MONEYMAN_CONFIG_PATH && !MONEYMAN_CONFIG) {
    MoneymanConfigSchema.parse(
      parseJsoncConfig(readFileSync(MONEYMAN_CONFIG_PATH, "utf8")),
    );
    console.log("✅ Config parsing successful");
  } else if (!MONEYMAN_CONFIG) {
    console.warn("⚠️ No config provided, using an empty object");
  } else {
    const parsedConfig = parseJsoncConfig(MONEYMAN_CONFIG);
    MoneymanConfigSchema.parse(parsedConfig);
    console.log("✅ Config parsing successful");
  }
} catch (error: any) {
  console.error(
    "❌ Config parsing failed:",
    "errors" in error ? error.errors : error.message,
  );
  process.exit(1);
}
