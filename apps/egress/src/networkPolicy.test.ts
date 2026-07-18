import { isPublicAddress } from "./networkPolicy.js";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "64:ff9b::a9fe:a9fe",
    "2001:0:4136:e378::",
    "2001:0000:4136:e378::",
    "2001:00:4136:e378::",
    "2001:000:4136:e378::",
    "fc00::1",
    "fe80::1",
  ])("blocks non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});
