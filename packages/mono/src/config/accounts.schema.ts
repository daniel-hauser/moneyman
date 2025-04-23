import { z } from "zod";
import { CompanyTypes } from "israeli-bank-scrapers";

// Base account config that all accounts must have
export const BaseAccountConfig = z.object({
  companyId: z
    .enum(CompanyTypes)
    .describe("The company identifier from israeli-bank-scrapers"),
});

// Bank-specific credential schemas (based on israeli-bank-scrapers requirements)
export const HapoalimCredentials = z.object({
  userCode: z.string().describe("User code"),
  password: z.string().describe("Password"),
});

export const LeumiBankCredentials = z.object({
  username: z.string().describe("Username"),
  password: z.string().describe("Password"),
});

export const VisaCalCredentials = z.object({
  username: z.string().describe("Username"),
  password: z.string().describe("Password"),
});

export const IsracardCredentials = z.object({
  id: z.string().describe("ID number"),
  card6Digits: z.string().describe("Last 6 digits of the card"),
  password: z.string().describe("Password"),
});

export const AmexCredentials = z.object({
  id: z.string().describe("ID number"),
  card6Digits: z.string().describe("Last 6 digits of the card"),
  password: z.string().describe("Password"),
});

export const MaxCredentials = z.object({
  username: z.string().describe("Username"),
  password: z.string().describe("Password"),
});

export const DiscountCredentials = z.object({
  id: z.string().describe("ID number"),
  password: z.string().describe("Password"),
  num: z.string().optional().describe("Account number (optional)"),
});

export const OtsarHahayalCredentials = z.object({
  username: z.string().describe("Username"),
  password: z.string().describe("Password"),
});

export const BeinhleumimCredentials = z.object({
  username: z.string().describe("Username"),
  password: z.string().describe("Password"),
});

export const UnionBankCredentials = z.object({
  username: z.string().describe("Username"),
  password: z.string().describe("Password"),
});

export const MizrahiCredentials = z.object({
  username: z.string().describe("Username"),
  password: z.string().describe("Password"),
});

// Union type of all account configurations
export const AccountConfig = z.discriminatedUnion("companyId", [
  BaseAccountConfig.extend(HapoalimCredentials).extend({
    companyId: z.literal(CompanyTypes.hapoalim),
  }),
  BaseAccountConfig.extend(LeumiBankCredentials).extend({
    companyId: z.literal(CompanyTypes.leumi),
  }),
  BaseAccountConfig.extend(VisaCalCredentials).extend({
    companyId: z.literal(CompanyTypes.visaCal),
  }),
  BaseAccountConfig.extend(IsracardCredentials).extend({
    companyId: z.literal(CompanyTypes.isracard),
  }),
  BaseAccountConfig.extend(AmexCredentials).extend({
    companyId: z.literal(CompanyTypes.amex),
  }),
  BaseAccountConfig.extend(MaxCredentials).extend({
    companyId: z.literal(CompanyTypes.max),
  }),
  BaseAccountConfig.extend(DiscountCredentials).extend({
    companyId: z.literal(CompanyTypes.discount),
  }),
  BaseAccountConfig.extend(OtsarHahayalCredentials).extend({
    companyId: z.literal(CompanyTypes.otsarHahayal),
  }),
  BaseAccountConfig.extend(BeinhleumimCredentials).extend({
    companyId: z.literal(CompanyTypes.beinleumi),
  }),
  BaseAccountConfig.extend(UnionBankCredentials).extend({
    companyId: z.literal(CompanyTypes.union),
  }),
  BaseAccountConfig.extend(MizrahiCredentials).extend({
    companyId: z.literal(CompanyTypes.mizrahi),
  }),
]);

// Array of account configs
export const AccountsArray = z.array(AccountConfig);

export type AccountConfigType = z.infer<typeof AccountConfig>;
