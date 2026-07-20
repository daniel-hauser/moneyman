import { EgressConfigSchema } from "@moneyman/common";
import { isAllowedDestination } from "./config.js";

describe("egress destination policy", () => {
  it("keeps public mode restricted to standard web ports", () => {
    const config = EgressConfigSchema.parse({ mode: "public" });

    expect(isAllowedDestination(config, "example.com", 80)).toBe(true);
    expect(isAllowedDestination(config, "example.com", 443)).toBe(true);
    expect(isAllowedDestination(config, "example.com", 8080)).toBe(false);
  });

  it("allows only configured host and port combinations", () => {
    const config = EgressConfigSchema.parse({
      mode: "allowlist",
      destinations: [
        { hostname: "example.com", ports: [8443] },
        { hostname: "blob.core.windows.net", ports: [443] },
      ],
    });

    expect(isAllowedDestination(config, "api.example.com", 8443)).toBe(true);
    expect(isAllowedDestination(config, "api.example.com", 443)).toBe(false);
    expect(
      isAllowedDestination(config, "account.blob.core.windows.net", 443),
    ).toBe(true);
    expect(isAllowedDestination(config, "notexample.com", 8443)).toBe(false);
  });

  it("rejects duplicate HTTP and TCP listener ports", () => {
    expect(() =>
      EgressConfigSchema.parse({
        mode: "allowlist",
        listenPort: 8080,
        tcpForwards: [
          { listenPort: 8080, hostname: "database.example", port: 5432 },
        ],
      }),
    ).toThrow("Duplicate egress listen port");
  });
});
