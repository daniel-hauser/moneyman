import { z } from "zod";
import { parseJsoncConfig } from "./utils/jsonc.js";

const ConfigSecretSchema = z.discriminatedUnion("provider", [
  z.strictObject({
    provider: z.literal("bitwarden"),
    secretId: z.uuid(),
    accessToken: z.string().min(1),
  }),
]);

export function getConfigSecretEnvironment(
  configSecret: string,
): NodeJS.ProcessEnv {
  const descriptor = ConfigSecretSchema.parse(parseJsoncConfig(configSecret));

  switch (descriptor.provider) {
    case "bitwarden":
      return {
        BITWARDEN_ACCESS_TOKEN: descriptor.accessToken,
        MONEYMAN_CONFIG_SECRET_ID: descriptor.secretId,
        MONEYMAN_CONFIG_SECRET_PROVIDER: descriptor.provider,
      };
  }
}

export function createConfigSecretProcessEnvironment(
  configSecret: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = {
    ...baseEnvironment,
    ...getConfigSecretEnvironment(configSecret),
  };

  delete environment.MONEYMAN_CONFIG;
  delete environment.MONEYMAN_CONFIG_PATH;
  delete environment.MONEYMAN_CONFIG_SECRET;

  return environment;
}
