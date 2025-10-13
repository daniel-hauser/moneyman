import { shouldCreateOtpRetriever, prepareAccountCredentials } from "./otp.js";
import { AccountConfig } from "../types.js";
import { CompanyTypes } from "israeli-bank-scrapers";

// Mock the config module
jest.mock("../config.js", () => ({
  config: {
    options: {
      notifications: {
        telegram: {
          enableOtp: true,
        },
      },
    },
  },
}));

// Mock the notifier module
jest.mock("../bot/notifier.js", () => ({
  requestOtpCode: jest.fn().mockResolvedValue("123456"),
}));

describe("OTP utilities", () => {
  describe("shouldCreateOtpRetriever", () => {
    it("should return true for OneZero account with phone number and OTP enabled", () => {
      const account = {
        companyId: CompanyTypes.oneZero,
        email: "test@example.com",
        password: "password",
        phoneNumber: "+972501234567",
      } as AccountConfig;

      expect(shouldCreateOtpRetriever(account)).toBe(true);
    });

    it("should return false for OneZero account with otpLongTermToken", () => {
      const account = {
        companyId: CompanyTypes.oneZero,
        email: "test@example.com",
        password: "password",
        phoneNumber: "+972501234567",
        otpLongTermToken: "token123",
      } as AccountConfig;

      expect(shouldCreateOtpRetriever(account)).toBe(false);
    });

    it("should return false for OneZero account without phone number", () => {
      const account = {
        companyId: CompanyTypes.oneZero,
        email: "test@example.com",
        password: "password",
      } as AccountConfig;

      expect(shouldCreateOtpRetriever(account)).toBe(false);
    });

    it("should return false for non-OneZero account", () => {
      const account = {
        companyId: CompanyTypes.hapoalim,
        userCode: "123456",
        password: "password",
      } as AccountConfig;

      expect(shouldCreateOtpRetriever(account)).toBe(false);
    });
  });

  describe("prepareAccountCredentials", () => {
    it("should add otpCodeRetriever for eligible OneZero accounts", () => {
      const account = {
        companyId: CompanyTypes.oneZero,
        email: "test@example.com",
        password: "password",
        phoneNumber: "+972501234567",
      } as AccountConfig;

      const prepared = prepareAccountCredentials(account);

      expect(prepared).toHaveProperty("otpCodeRetriever");
      expect(typeof (prepared as any).otpCodeRetriever).toBe("function");
    });

    it("should not modify accounts that don't need OTP", () => {
      const account = {
        companyId: CompanyTypes.hapoalim,
        userCode: "123456",
        password: "password",
      } as AccountConfig;

      const prepared = prepareAccountCredentials(account);

      expect(prepared).toEqual({});
      expect(account).toEqual({
        companyId: CompanyTypes.hapoalim,
        userCode: "123456",
        password: "password",
      });
    });

    it("should not modify OneZero accounts with otpLongTermToken", () => {
      const account = {
        companyId: CompanyTypes.oneZero,
        email: "test@example.com",
        password: "password",
        phoneNumber: "+972501234567",
        otpLongTermToken: "token123",
      } as AccountConfig;

      const prepared = prepareAccountCredentials(account);

      expect(prepared).toEqual({});
      expect(account).toEqual({
        companyId: CompanyTypes.oneZero,
        email: "test@example.com",
        password: "password",
        phoneNumber: "+972501234567",
        otpLongTermToken: "token123",
      });
    });
  });
});
