import {
  createServer,
  request as httpRequest,
  type OutgoingHttpHeaders,
} from "node:http";
import { request as httpsRequest } from "node:https";
import {
  connect,
  createServer as createTcpServer,
  type Socket,
} from "node:net";
import { createLogger, type EgressConfig } from "@moneyman/common";

const logger = createLogger("egress");

export type AddressResolver = (
  hostname: string,
  port: number,
) => Promise<string>;

export function createHttpProxyServer(resolveAddress: AddressResolver) {
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
      const address = await resolveAddress(target.hostname, port);
      const headers: OutgoingHttpHeaders = {
        ...request.headers,
        host: target.host,
      };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstreamRequest = (
        target.protocol === "https:" ? httpsRequest : httpRequest
      )({
        hostname: address,
        port,
        path: `${target.pathname}${target.search}`,
        method: request.method,
        headers,
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
      const address = await resolveAddress(hostname, port);
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

  return server;
}

export function createTcpForwardServer(
  forward: EgressConfig["tcpForwards"][number],
  resolveAddress: AddressResolver,
) {
  return createTcpServer((clientSocket) => {
    clientSocket.on("error", (error) => {
      logger("TCP forward client socket closed with an error", error);
    });
    void connectTcpForward(clientSocket, forward, resolveAddress);
  });
}

async function connectTcpForward(
  clientSocket: Socket,
  forward: EgressConfig["tcpForwards"][number],
  resolveAddress: AddressResolver,
) {
  try {
    const address = await resolveAddress(forward.hostname, forward.port);
    const upstreamSocket = connect(forward.port, address, () => {
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });
    upstreamSocket.on("error", () => clientSocket.destroy());
  } catch (error) {
    logger("Blocked TCP forward", error);
    clientSocket.destroy();
  }
}

function parseAuthority(authority: string) {
  const url = new URL(`http://${authority}`);
  return {
    hostname: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number.parseInt(url.port || "443", 10),
  };
}
