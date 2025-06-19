#!/usr/bin/env node
import "dotenv/config";
import { MoneymanConfigSchema } from "../config.schema.js";

try {
  console.log("🔍 Verifying config parsing...");
  MoneymanConfigSchema.parse(JSON.parse(process.env.MONEYMAN_CONFIG || "{}"));
  console.log("✅ Config parsing successful");
} catch (error: any) {
  console.error(
    "❌ Config parsing failed:",
    "errors" in error ? error.errors : error.message,
  );
  process.exit(1);
}
