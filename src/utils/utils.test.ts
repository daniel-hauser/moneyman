import { sha256 } from "./utils.js";

describe("sha256", () => {
  it.each([
    ["base64", "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0="],
    ["base64url", "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"],
    ["hex", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ] as const)("returns the known %s digest", (encoding, expected) => {
    expect(sha256("abc", encoding)).toBe(expected);
  });
});
