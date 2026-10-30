import { WorkerConfigSchema } from "./protocol.js";
import { workerEnvironment } from "./environment.js";

describe("scraper boundary validation", () => {
  it("rejects full configuration objects rather than accepting storage secrets", () => {
    expect(
      WorkerConfigSchema.safeParse({ storage: { secret: "not allowed" } })
        .success,
    ).toBe(false);
  });

  it("keeps Dates cloneable and rejects credential functions instead of proxying them", () => {
    const settings = {
      accounts: [{ companyId: "oneZero", password: "fixture" }],
      startDate: new Date("2026-01-01T00:00:00Z"),
      futureMonthsToScrape: 1,
      parallelScrapers: 1,
      additionalTransactionInformation: false,
      includeRawTransaction: true,
      domainTracking: false,
      firewallSettings: [],
      blockByDefault: false,
      enableOtp: true,
      debugFilter: "",
    };
    expect(WorkerConfigSchema.parse(settings).startDate).toEqual(
      settings.startDate,
    );
    expect(
      WorkerConfigSchema.safeParse({
        ...settings,
        accounts: [
          {
            ...settings.accounts[0],
            otpCodeRetriever: async () => "not transferable",
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("allows Windows runtime paths case-insensitively without unrelated settings", () => {
    expect(
      workerEnvironment({
        Path: "runtime-path",
        SystemRoot: "windows-path",
        PUPPETEER_EXECUTABLE_PATH: "browser-path",
        moneyMan_CONFIG: "private",
        Node_Options: "private",
        arbitrarySecret: "private",
      }),
    ).toEqual({
      Path: "runtime-path",
      SystemRoot: "windows-path",
      PUPPETEER_EXECUTABLE_PATH: "browser-path",
    });
  });
});
