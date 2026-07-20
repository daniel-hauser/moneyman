import { readFileSync } from "node:fs";
import { parseJsoncConfig } from "@moneyman/common";
import { LegacyMoneymanConfigSchema } from "@moneyman/protocol";

try {
  console.log("Verifying config parsing...");
  const configString =
    process.env.MONEYMAN_CONFIG ??
    (process.env.MONEYMAN_CONFIG_PATH
      ? readFileSync(process.env.MONEYMAN_CONFIG_PATH, "utf8")
      : undefined);
  if (!configString) {
    console.warn("No config provided; validating defaults");
    LegacyMoneymanConfigSchema.parse({});
  } else {
    const parsedConfig = parseJsoncConfig(configString);
    LegacyMoneymanConfigSchema.parse(parsedConfig);
  }
  console.log("Config parsing successful");
} catch (error) {
  console.error("Config parsing failed:", error);
  process.exit(1);
}
