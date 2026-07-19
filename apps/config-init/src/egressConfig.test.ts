import { SQL_EGRESS_PORT } from "@moneyman/common";
import { splitLegacyConfig } from "@moneyman/protocol";
import { buildEgressConfigs } from "./egressConfig.js";

describe("buildEgressConfigs", () => {
  it("parses scraper ALLOW rules without treating comments as policy", () => {
    const configs = splitLegacyConfig({
      accounts: [{ companyId: "max", password: "synthetic" }],
      storage: { localJson: { enabled: true } },
      options: {
        security: {
          blockByDefault: true,
          firewallSettings: [
            "  max ALLOW api.example.com  ",
            "# ALLOW ignored.example",
          ],
        },
        logging: { getIpInfoUrl: false },
      },
    });

    expect(buildEgressConfigs(configs).scraper).toMatchObject({
      mode: "allowlist",
      destinations: [{ hostname: "api.example.com", ports: [80, 443] }],
    });
  });

  it("preserves custom HTTP ports and creates a constrained SQL forward", () => {
    const configs = splitLegacyConfig({
      accounts: [{ companyId: "max", password: "synthetic" }],
      storage: {
        actual: {
          serverUrl: "https://actual.example:8443",
          password: "synthetic",
          budgetId: "synthetic",
          accounts: {},
        },
        webPost: {
          url: "http://web-post.example:8080/import",
          authorizationToken: "synthetic",
        },
        sql: {
          connectionString:
            "postgresql://synthetic:synthetic@database.example:6543/moneyman",
        },
      },
    });

    const egress = buildEgressConfigs(configs);

    expect(egress.exporter.destinations).toEqual(
      expect.arrayContaining([
        { hostname: "actual.example", ports: [8443] },
        { hostname: "web-post.example", ports: [8080] },
      ]),
    );
    expect(egress.exporter.tcpForwards).toEqual([
      {
        listenPort: SQL_EGRESS_PORT,
        hostname: "database.example",
        port: 6543,
      },
    ]);
  });

  it("allows Azure ingestion service-assigned storage hosts", () => {
    const configs = splitLegacyConfig({
      accounts: [{ companyId: "max", password: "synthetic" }],
      storage: {
        azure: {
          appId: "synthetic",
          appKey: "synthetic",
          tenantId: "synthetic",
          databaseName: "synthetic",
          tableName: "synthetic",
          ingestionMapping: "synthetic",
          ingestUri: "https://ingest-cluster.example.kusto.windows.net",
        },
      },
    });

    expect(buildEgressConfigs(configs).exporter.destinations).toEqual(
      expect.arrayContaining([
        { hostname: "blob.core.windows.net", ports: [443] },
        { hostname: "queue.core.windows.net", ports: [443] },
        { hostname: "login.microsoftonline.com", ports: [443] },
      ]),
    );
  });

  it("normalizes an IPv6 PostgreSQL target", () => {
    const configs = splitLegacyConfig({
      accounts: [{ companyId: "max", password: "synthetic" }],
      storage: {
        sql: {
          connectionString:
            "postgresql://synthetic:synthetic@[2001:4860:4860::8888]:6543/moneyman",
        },
      },
    });

    expect(buildEgressConfigs(configs).exporter.tcpForwards).toEqual([
      {
        listenPort: SQL_EGRESS_PORT,
        hostname: "2001:4860:4860::8888",
        port: 6543,
      },
    ]);
  });

  it("rejects non-URI PostgreSQL connection strings", () => {
    const configs = splitLegacyConfig({
      accounts: [{ companyId: "max", password: "synthetic" }],
      storage: {
        sql: {
          connectionString: "host=database.example port=5432 dbname=moneyman",
        },
      },
    });

    expect(() => buildEgressConfigs(configs)).toThrow(
      "Unable to derive the SQL storage egress target",
    );
  });
});
