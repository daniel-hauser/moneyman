const UNKNOWN_METADATA_VALUE = "unknown";

export interface BuildMetadata {
  buildSha: string;
  runMetadata: string;
}

function valueOrUnknown(value: string | undefined): string {
  return value?.trim() || UNKNOWN_METADATA_VALUE;
}

export function getBuildMetadata(
  env: NodeJS.ProcessEnv = process.env,
): BuildMetadata {
  return {
    buildSha: valueOrUnknown(env.MONEYMAN_BUILD_SHA),
    runMetadata: valueOrUnknown(env.MONEYMAN_RUN_METADATA),
  };
}
