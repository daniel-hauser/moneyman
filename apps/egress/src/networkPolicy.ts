import { isIP } from "node:net";

export function normalizeProxyHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

export function isPublicAddress(address: string): boolean {
  const normalized = normalizeProxyHostname(address);
  const family = isIP(normalized);

  if (family === 4) {
    return isPublicIpv4(normalized);
  }
  if (family !== 6) {
    return false;
  }

  const hextets = expandIpv6(normalized);
  if (!hextets) {
    return false;
  }
  const isUnspecified = hextets.every((hextet) => hextet === 0);
  const isLoopback =
    hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1;
  const isIpv4Mapped =
    hextets.slice(0, 5).every((hextet) => hextet === 0) &&
    hextets[5] === 0xffff;
  const isNat64 =
    hextets[0] === 0x64 &&
    hextets[1] === 0xff9b &&
    (hextets.slice(2, 6).every((hextet) => hextet === 0) || hextets[2] === 1);
  const isDiscardOnly =
    hextets[0] === 0x100 && hextets.slice(1, 4).every((hextet) => hextet === 0);
  const isTeredo = hextets[0] === 0x2001 && hextets[1] === 0;
  const isDocumentation = hextets[0] === 0x2001 && hextets[1] === 0x0db8;
  const isSixToFour = hextets[0] === 0x2002;
  const isUniqueLocal = (hextets[0] & 0xfe00) === 0xfc00;
  const isLinkLocal = (hextets[0] & 0xffc0) === 0xfe80;
  const isMulticast = (hextets[0] & 0xff00) === 0xff00;

  if (
    isUnspecified ||
    isLoopback ||
    normalized.includes(".") ||
    isIpv4Mapped ||
    isNat64 ||
    isDiscardOnly ||
    isTeredo ||
    isDocumentation ||
    isSixToFour ||
    isUniqueLocal ||
    isLinkLocal ||
    isMulticast
  ) {
    return false;
  }

  return (hextets[0] & 0xe000) === 0x2000;
}

function expandIpv6(address: string): number[] | undefined {
  const halves = address.split("::");
  if (halves.length > 2) {
    return undefined;
  }

  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (
    missing < 0 ||
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return undefined;
  }

  const parts = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (
    parts.length !== 8 ||
    parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
  ) {
    return undefined;
  }
  return parts.map((part) => Number.parseInt(part, 16));
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first, second, third] = octets;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}
