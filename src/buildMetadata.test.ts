import { getBuildMetadata } from "./buildMetadata.js";

describe("getBuildMetadata", () => {
  it("returns injected build and run metadata", () => {
    expect(
      getBuildMetadata({
        MONEYMAN_BUILD_SHA: "abc123",
        MONEYMAN_RUN_METADATA: '{"runId":"42"}',
      }),
    ).toEqual({
      buildSha: "abc123",
      runMetadata: '{"runId":"42"}',
    });
  });

  it("uses an explicit fallback when metadata is unavailable", () => {
    expect(getBuildMetadata({})).toEqual({
      buildSha: "unknown",
      runMetadata: "unknown",
    });
  });
});
