import { AccountConfig } from "../types.js";
import { config } from "../config.js";
import { requestOtpCode } from "../bot/notifier.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("otp");

/**
 * Creates an OTP code retriever function for OneZero accounts
 */
function createOtpCodeRetriever(account: AccountConfig): () => Promise<string> {
  return async () => {
    if (!config.options.notifications.telegram?.enableOtp) {
      throw new Error("OTP is not enabled in configuration");
    }

    const phoneNumber = (account as any).phoneNumber;
    logger(
      `Requesting OTP code for ${account.companyId} account (phone: ${phoneNumber})`,
    );
    return await requestOtpCode(account.companyId, phoneNumber);
  };
}

/**
 * Checks if an account should have an OTP code retriever attached
 */
export function shouldCreateOtpRetriever(account: AccountConfig): boolean {
  return (
    account.companyId === "oneZero" &&
    config.options.notifications.telegram?.enableOtp === true &&
    "phoneNumber" in account &&
    !!account.phoneNumber &&
    !("otpLongTermToken" in account)
  );
}

/**
 * Prepares the account credentials with OTP support if needed
 */
export function prepareAccountCredentials(
  account: AccountConfig,
): Partial<AccountConfig> {
  if (shouldCreateOtpRetriever(account)) {
    logger(`Setting up OTP code retriever for OneZero account`);

    return {
      otpCodeRetriever: createOtpCodeRetriever(account),
    };
  }

  return {};
}
