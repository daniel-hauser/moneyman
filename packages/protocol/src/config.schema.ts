import z from "zod/v4";

export const AccountSchema = z.looseObject({
  companyId: z.string().min(1).max(64),
  password: z.string().min(1),
});

export const GoogleSheetsSchema = z.object({
  serviceAccountPrivateKey: z.string().min(1),
  serviceAccountEmail: z.email(),
  sheetId: z.string().min(1),
  worksheetName: z.string().min(1),
});

export const YnabSchema = z.object({
  token: z.string().min(1),
  budgetId: z.string().min(1),
  accounts: z.record(z.string(), z.string()),
});

export const AzureSchema = z.object({
  appId: z.string().min(1),
  appKey: z.string().min(1),
  tenantId: z.string().min(1),
  databaseName: z.string().min(1),
  tableName: z.string().min(1),
  ingestionMapping: z.string().min(1),
  ingestUri: z.url(),
});

export const BuxferSchema = z.object({
  userName: z.string().min(1),
  password: z.string().min(1),
  accounts: z.record(z.string(), z.string()),
});

export const ActualSchema = z.object({
  serverUrl: z.url(),
  password: z.string().min(1),
  budgetId: z.string().min(1),
  accounts: z.record(z.string(), z.string()),
});

export const WebPostSchema = z.object({
  url: z.url(),
  authorizationToken: z.string().min(1),
});

export const SqlStorageSchema = z.object({
  connectionString: z.string().min(1),
  schema: z
    .string()
    .min(1)
    .regex(/^[A-Za-z_]\w*$/)
    .default("moneyman"),
});

export const LocalJsonSchema = z.object({
  enabled: z.boolean(),
  path: z.string().optional(),
});

export const MoneymanDashSchema = z.object({
  token: z.string().min(1),
});

export const TelegramStorageSchema = z.object({
  enabled: z.boolean().default(true),
});

export const StorageSchema = z
  .object({
    googleSheets: GoogleSheetsSchema.optional(),
    ynab: YnabSchema.optional(),
    azure: AzureSchema.optional(),
    buxfer: BuxferSchema.optional(),
    actual: ActualSchema.optional(),
    localJson: LocalJsonSchema.optional(),
    webPost: WebPostSchema.optional(),
    sql: SqlStorageSchema.optional(),
    telegram: TelegramStorageSchema.optional(),
    moneyman: MoneymanDashSchema.optional(),
  })
  .refine((data) => Object.values(data).some(Boolean), {
    error: "At least one storage provider must be configured",
  })
  .default({ localJson: { enabled: true } });

export const ScrapingOptionsSchema = z.object({
  accountsToScrape: z.array(z.string()).optional(),
  daysBack: z.number().min(1).max(365).default(10),
  futureMonths: z.number().min(0).max(12).default(1),
  additionalTransactionInfo: z.boolean().default(false),
  includeRawTransaction: z.boolean().default(false),
  puppeteerExecutablePath: z.string().optional(),
  maxParallelScrapers: z.number().min(1).max(10).default(1),
  domainTracking: z.boolean().default(false),
});

export const SecurityOptionsSchema = z.object({
  firewallSettings: z.array(z.string()).optional(),
  blockByDefault: z.boolean().default(true),
});

const LegacySecurityOptionsSchema = SecurityOptionsSchema.extend({
  blockByDefault: z.boolean().default(false),
});

export const LoggingOptionsSchema = z.object({
  getIpInfoUrl: z
    .union([z.literal(false), z.string().url()])
    .default("https://ipinfo.io/json"),
  debugFilter: z.string().optional().default("moneyman:*"),
});

export const ServiceEndpointsSchema = z.object({
  exporterUrl: z.url().default("http://exporter:3002"),
  notifierUrl: z.url().default("http://notifier:3001"),
});

export const ScraperAppConfigSchema = z.object({
  accounts: z.array(AccountSchema).min(1),
  options: z.object({
    scraping: ScrapingOptionsSchema.prefault({}),
    security: SecurityOptionsSchema.prefault({}),
    logging: LoggingOptionsSchema.prefault({}),
    otp: z
      .object({
        enabled: z.boolean().default(false),
      })
      .prefault({}),
  }),
  services: ServiceEndpointsSchema.prefault({}),
});

export const ExporterAppConfigSchema = z.object({
  storage: StorageSchema,
  options: z.object({
    scraping: z.object({
      transactionHashType: z.enum(["", "moneyman"]).default(""),
      hiddenDeprecations: z.array(z.string()).default([]),
    }),
    logging: LoggingOptionsSchema.prefault({}),
  }),
  services: z
    .object({
      notifierUrl: z.url().default("http://notifier:3001"),
    })
    .prefault({}),
});

export const TelegramOptionsSchema = z.object({
  apiKey: z.string().min(1),
  chatId: z.string().min(1),
  enableOtp: z.boolean().default(false),
  otpTimeoutSeconds: z.number().min(30).max(600).default(300),
  sendLogFileToTelegram: z.boolean().default(true),
});

export const LegacyMoneymanConfigSchema = z
  .object({
    accounts: z.array(AccountSchema).default([]),
    storage: StorageSchema,
    options: z
      .object({
        scraping: ScrapingOptionsSchema.extend({
          transactionHashType: z.enum(["", "moneyman"]).default(""),
          hiddenDeprecations: z.array(z.string()).default([]),
        }).prefault({}),
        security: LegacySecurityOptionsSchema.prefault({}),
        notifications: z
          .object({
            telegram: TelegramOptionsSchema.optional(),
          })
          .prefault({}),
        logging: LoggingOptionsSchema.prefault({}),
      })
      .prefault({}),
  })
  .prefault({});

export const NotifierAppConfigSchema = z.object({
  telegram: TelegramOptionsSchema.optional(),
  logging: LoggingOptionsSchema.prefault({}),
  listenPort: z.number().int().min(1).max(65535).default(3001),
  legacyConfigNotice: z.boolean().default(false),
  expectedLogSources: z
    .array(z.enum(["scraper", "exporter"]))
    .default(["scraper", "exporter"]),
});

export type ScraperAppConfig = z.infer<typeof ScraperAppConfigSchema>;
export type ExporterAppConfig = z.infer<typeof ExporterAppConfigSchema>;
export type NotifierAppConfig = z.infer<typeof NotifierAppConfigSchema>;
export type LegacyMoneymanConfig = z.infer<typeof LegacyMoneymanConfigSchema>;
export type StorageConfig = z.infer<typeof StorageSchema>;

export interface SplitAppConfigs {
  scraper: ScraperAppConfig;
  exporter: ExporterAppConfig;
  notifier: NotifierAppConfig;
}

export function splitLegacyConfig(input: unknown): SplitAppConfigs {
  const legacy = LegacyMoneymanConfigSchema.parse(input);
  const { transactionHashType, hiddenDeprecations, ...scrapingOptions } =
    legacy.options.scraping;

  return {
    scraper: ScraperAppConfigSchema.parse({
      accounts: legacy.accounts,
      options: {
        scraping: scrapingOptions,
        security: legacy.options.security,
        logging: legacy.options.logging,
        otp: {
          enabled: legacy.options.notifications.telegram?.enableOtp ?? false,
        },
      },
    }),
    exporter: ExporterAppConfigSchema.parse({
      storage: {
        ...legacy.storage,
        telegram:
          legacy.storage.telegram ??
          (legacy.options.notifications.telegram
            ? { enabled: true }
            : undefined),
      },
      options: {
        scraping: {
          transactionHashType,
          hiddenDeprecations,
        },
        logging: legacy.options.logging,
      },
    }),
    notifier: NotifierAppConfigSchema.parse({
      telegram: legacy.options.notifications.telegram,
      logging: legacy.options.logging,
      legacyConfigNotice: true,
    }),
  };
}
