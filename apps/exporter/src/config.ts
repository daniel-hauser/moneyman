import { loadConfig } from "@moneyman/common";
import {
  ExporterAppConfigSchema,
  type ExporterAppConfig,
} from "@moneyman/protocol";

export const config: ExporterAppConfig = loadConfig(ExporterAppConfigSchema, {
  inlineEnvironmentVariable: "MONEYMAN_EXPORTER_CONFIG",
  pathEnvironmentVariable: "MONEYMAN_EXPORTER_CONFIG_PATH",
});
