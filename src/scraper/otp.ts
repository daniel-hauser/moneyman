import type { AccountConfig } from "../types.js";
import { createLogger } from "../utils/logger.js";

export type OtpRequest = (
  companyId: string,
  phoneNumber: string,
) => Promise<string>;

const logger = createLogger("otp");

/**
 * Creates an OTP code retriever function for OneZero accounts
 */
function createOtpCodeRetriever(
  account: AccountConfig,
  requestOtpCode: OtpRequest,
): () => Promise<string> {
  return async () => {
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
export function shouldCreateOtpRetriever(
  account: AccountConfig,
  enableOtp = false,
): boolean {
  return (
    account.companyId === "oneZero" &&
    enableOtp &&
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
  requestOtpCode?: OtpRequest,
): Partial<AccountConfig> {
  if (shouldCreateOtpRetriever(account, !!requestOtpCode)) {
    logger(`Setting up OTP code retriever for OneZero account`);

    return {
      otpCodeRetriever: createOtpCodeRetriever(account, requestOtpCode!),
    };
  }

  return {};
}
