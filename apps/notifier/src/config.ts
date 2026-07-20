import { loadConfig } from "@moneyman/common";
import {
  NotifierAppConfigSchema,
  type NotifierAppConfig,
} from "@moneyman/protocol";

export const config: NotifierAppConfig = loadConfig(NotifierAppConfigSchema, {
  inlineEnvironmentVariable: "MONEYMAN_NOTIFIER_CONFIG",
  pathEnvironmentVariable: "MONEYMAN_NOTIFIER_CONFIG_PATH",
});
