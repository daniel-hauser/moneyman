import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { createLogger, enableDebugLogging } from "@moneyman/common";
import { isPublicAddress, normalizeProxyHostname } from "./networkPolicy.js";
import { isAllowedDestination, loadEgressConfig } from "./config.js";
import { createHttpProxyServer, createTcpForwardServer } from "./servers.js";

const logger = createLogger("egress");
const config = loadEgressConfig();
enableDebugLogging("moneyman:*");

listen(
  createHttpProxyServer(resolveAllowedAddress),
  config.listenPort,
  "HTTP proxy",
);

for (const forward of config.tcpForwards) {
  listen(
    createTcpForwardServer(forward, (hostname) =>
      resolvePublicAddress(hostname),
    ),
    forward.listenPort,
    "TCP forward",
  );
}

async function resolveAllowedAddress(
  hostname: string,
  port: number,
): Promise<string> {
  const normalizedHostname = normalizeProxyHostname(hostname);
  if (!isAllowedDestination(config, normalizedHostname, port)) {
    throw new Error(`Destination ${hostname}:${port} is not allowlisted`);
  }
  return resolvePublicAddress(normalizedHostname);
}

async function resolvePublicAddress(hostname: string): Promise<string> {
  const normalizedHostname = normalizeProxyHostname(hostname);
  const addresses = isIP(normalizedHostname)
    ? [{ address: normalizedHostname }]
    : await lookup(normalizedHostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new Error(`Destination ${hostname} resolved to a non-public address`);
  }
  return addresses[0].address;
}

function listen(
  server: import("node:net").Server | import("node:http").Server,
  port: number,
  name: string,
) {
  server.on("error", (error) => {
    logger(`${name} failed`, error);
    process.exit(1);
  });
  server.listen(port, "0.0.0.0");
}
