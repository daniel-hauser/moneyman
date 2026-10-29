import {
  createConfigSecretProcessEnvironment,
  getConfigSecretEnvironment,
} from "./configSecret.js";

describe("getConfigSecretEnvironment", () => {
  it("maps a Bitwarden descriptor to its Varlock environment", () => {
    const environment = getConfigSecretEnvironment(
      JSON.stringify({
        provider: "bitwarden",
        secretId: "11111111-2222-4333-8444-555555666666",
        accessToken: "test-access-token",
      }),
    );

    expect(environment).toEqual({
      BITWARDEN_ACCESS_TOKEN: "test-access-token",
      MONEYMAN_CONFIG_SECRET_ID: "11111111-2222-4333-8444-555555666666",
      MONEYMAN_CONFIG_SECRET_PROVIDER: "bitwarden",
    });
  });

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

  it("removes lower-precedence config sources from the provider environment", () => {
    const environment = createConfigSecretProcessEnvironment(
      JSON.stringify({
        provider: "bitwarden",
        secretId: "11111111-2222-4333-8444-555555666666",
        accessToken: "test-access-token",
      }),
      {
        MONEYMAN_CONFIG: "legacy-config",
        MONEYMAN_CONFIG_PATH: "/legacy/config.json",
        MONEYMAN_CONFIG_SECRET: "provider-descriptor",
        PRESERVED_VARIABLE: "preserved",
      },
    );

    expect(environment).toMatchObject({
      BITWARDEN_ACCESS_TOKEN: "test-access-token",
      MONEYMAN_CONFIG_SECRET_ID: "11111111-2222-4333-8444-555555666666",
      PRESERVED_VARIABLE: "preserved",
    });
    expect(environment.MONEYMAN_CONFIG).toBeUndefined();
    expect(environment.MONEYMAN_CONFIG_PATH).toBeUndefined();
    expect(environment.MONEYMAN_CONFIG_SECRET).toBeUndefined();
  });
});
