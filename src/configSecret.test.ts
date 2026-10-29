import { getConfigSecretEnvironment } from "./configSecret.js";

describe("getConfigSecretEnvironment", () => {
  it.each(["JSON", "object"] as const)(
    "maps a Bitwarden %s descriptor to its Varlock environment",
    (format) => {
      const descriptor = {
        provider: "bitwarden",
        secretId: "11111111-2222-4333-8444-555555666666",
        accessToken: "test-access-token",
      };
      const environment = getConfigSecretEnvironment(
        format === "JSON" ? JSON.stringify(descriptor) : descriptor,
      );

      expect(environment).toEqual({
        BITWARDEN_ACCESS_TOKEN: "test-access-token",
        MONEYMAN_CONFIG_SECRET_ID: "11111111-2222-4333-8444-555555666666",
      });
    },
  );

  it("rejects unsupported providers", () => {
    expect(() =>
      getConfigSecretEnvironment(
        JSON.stringify({
          provider: "unsupported",
          secretId: "11111111-2222-3333-4444-555555666666",
          accessToken: "test-access-token",
        }),
      ),
    ).toThrow();
  });

  it("rejects invalid descriptors", () => {
    expect(() =>
      getConfigSecretEnvironment(
        JSON.stringify({
          provider: "bitwarden",
          secretId: "not-a-uuid",
        }),
      ),
    ).toThrow();
  });

  it("rejects unknown descriptor fields", () => {
    expect(() =>
      getConfigSecretEnvironment(
        JSON.stringify({
          provider: "bitwarden",
          secretId: "11111111-2222-4333-8444-555555666666",
          accessToken: "test-access-token",
          apiUrl: "https://misspelled-or-unsupported.example",
        }),
      ),
    ).toThrow();
  });
});
