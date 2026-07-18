import { readFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect } from "node:net";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import z from "zod/v4";
import { createLogger, enableDebugLogging } from "@moneyman/common";
import { isPublicAddress, normalizeProxyHostname } from "./networkPolicy.js";

const logger = createLogger("egress");
const config = loadConfig();
enableDebugLogging("moneyman:*");

const server = createServer(async (request, response) => {
  try {
    if (request.url === "/health") {
      response.writeHead(200);
      response.end();
      return;
    }
    if (!request.url) {
      throw new Error("Missing target URL");
    }

    const target = new URL(request.url);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
    const port = Number.parseInt(
      target.port || (target.protocol === "https:" ? "443" : "80"),
      10,
    );
    const expectedPort = target.protocol === "https:" ? 443 : 80;
    if (port !== expectedPort) {
      throw new Error(
        `${target.protocol} proxy requests are restricted to port ${expectedPort}`,
      );
    }
    const address = await resolveAllowedAddress(target.hostname);
    const upstreamRequest = (
      target.protocol === "https:" ? httpsRequest : httpRequest
    )({
      hostname: address,
      port,
      path: `${target.pathname}${target.search}`,
      method: request.method,
      headers: {
        ...request.headers,
        host: target.host,
        "proxy-authorization": undefined,
      },
      servername: target.hostname,
    });
    upstreamRequest.on("response", (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    });
    upstreamRequest.on("error", (error) => {
      logger("Upstream request failed", error);
      response.writeHead(502);
      response.end();
    });
    request.pipe(upstreamRequest);
  } catch (error) {
    logger("Blocked proxy request", error);
    response.writeHead(403);
    response.end();
  }
});

server.on("connect", async (request, clientSocket, head) => {
  clientSocket.on("error", (error) => {
    logger("Proxy client socket closed with an error", error);
  });
  try {
    const { hostname, port } = parseAuthority(request.url ?? "");
    if (port !== 443) {
      throw new Error("CONNECT is restricted to port 443");
    }
    const address = await resolveAllowedAddress(hostname);
    const upstreamSocket = connect(port, address, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) {
        upstreamSocket.write(head);
      }
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });
    upstreamSocket.on("error", () => clientSocket.destroy());
  } catch (error) {
    logger("Blocked CONNECT request", error);
    clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  }
});

server.listen(config.listenPort, "0.0.0.0");

async function resolveAllowedAddress(hostname: string): Promise<string> {
  const normalizedHostname = normalizeProxyHostname(hostname);
  if (!isAllowedHostname(normalizedHostname)) {
    throw new Error(`Destination ${hostname} is not allowlisted`);
  }

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

function isAllowedHostname(hostname: string): boolean {
  if (config.mode === "public") {
    return true;
  }
  const normalized = normalizeProxyHostname(hostname);
  return config.allowlist.some(
    (allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`),
  );
}

function parseAuthority(authority: string) {
  const url = new URL(`http://${authority}`);
  return {
    hostname: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number.parseInt(url.port || "443", 10),
  };
}

function loadConfig() {
  const schema = z.strictObject({
    mode: z.enum(["public", "allowlist"]),
    allowlist: z
      .array(
        z
          .string()
          .toLowerCase()
          .regex(/^[a-z0-9.-]+$/),
      )
      .default([]),
    listenPort: z.number().int().positive().default(8080),
  });
  const path = process.env.MONEYMAN_EGRESS_CONFIG_PATH;
  if (!path) {
    throw new Error("MONEYMAN_EGRESS_CONFIG_PATH is required");
  }
  return schema.parse(JSON.parse(readFileSync(path, "utf8")));
}
