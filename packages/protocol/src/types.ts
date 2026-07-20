import z from "zod/v4";

export const systemName = "moneyman";

export const TransactionTypes = {
  Normal: "normal",
  Installments: "installments",
} as const;

export const TransactionStatuses = {
  Completed: "completed",
  Pending: "pending",
} as const;

export const TransactionSchema = z.strictObject({
  type: z.enum([TransactionTypes.Normal, TransactionTypes.Installments]),
  identifier: z.union([z.string().max(512), z.number()]).optional(),
  date: z.iso.datetime(),
  processedDate: z.iso.datetime(),
  originalAmount: z.number(),
  originalCurrency: z.string().min(1).max(16),
  chargedAmount: z.number(),
  chargedCurrency: z.string().min(1).max(16).optional(),
  description: z.string().max(4096),
  memo: z.string().max(4096).optional(),
  status: z.enum([TransactionStatuses.Completed, TransactionStatuses.Pending]),
  installments: z
    .strictObject({
      number: z.number().int().positive(),
      total: z.number().int().positive(),
    })
    .optional(),
  category: z.string().max(1024).optional(),
  rawTransaction: z.unknown().optional(),
});

export const TransactionRowSchema = TransactionSchema.extend({
  account: z.string().min(1).max(256),
  companyId: z.string().min(1).max(64),
  hash: z.string().min(1).max(8192),
  uniqueId: z.string().min(1).max(8192),
});

export const AccountStatusSchema = z.strictObject({
  companyId: z.string().min(1).max(64),
  success: z.boolean(),
  errorType: z.string().max(256).optional(),
  errorMessage: z.string().max(4096).optional(),
  accountCount: z.number().int().nonnegative().optional(),
  txnCount: z.number().int().nonnegative().optional(),
});

export const ScrapePayloadSchema = z.strictObject({
  accountResults: z.array(AccountStatusSchema).max(100),
  transactions: z.array(TransactionRowSchema).max(100_000),
});

export const LogSourceSchema = z.enum(["scraper", "exporter"]);

export const LogUploadSchema = z.strictObject({
  source: LogSourceSchema,
  captured: z.boolean(),
  content: z.string().max(20_000_000),
});

export const OtpRequestSchema = z.strictObject({
  companyId: z.string().min(1).max(64),
  phoneNumber: z.string().min(1).max(64),
});

export const TelegramMessageSchema = z.strictObject({
  message: z.string().max(16_384),
  parseMode: z.enum(["HTML"]).optional(),
});

export const TelegramEditSchema = TelegramMessageSchema.extend({
  messageId: z.number().int().positive().optional(),
});

export const ImagePayloadSchema = z.strictObject({
  caption: z.string().max(1024),
  contentBase64: z.string().max(15_000_000),
});

export const TelegramImagesSchema = z.strictObject({
  images: z.array(ImagePayloadSchema).max(10),
});

export const OkResponseSchema = z.strictObject({
  ok: z.literal(true),
});

export const TelegramMessageResponseSchema = z.strictObject({
  messageId: z.number().int().positive().optional(),
});

export const OtpResponseSchema = z.strictObject({
  code: z.string().min(1).max(32),
});

export type Transaction = z.infer<typeof TransactionSchema>;
export type TransactionRow = z.infer<typeof TransactionRowSchema>;
export type AccountStatus = z.infer<typeof AccountStatusSchema>;
export type ScrapePayload = z.infer<typeof ScrapePayloadSchema>;
export type LogSource = z.infer<typeof LogSourceSchema>;
export type ImagePayload = z.infer<typeof ImagePayloadSchema>;
export type TelegramMessageResponse = z.infer<
  typeof TelegramMessageResponseSchema
>;

export interface SaveContext {
  accountResults?: AccountStatus[];
}
