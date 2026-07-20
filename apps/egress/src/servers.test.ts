import { createServer as createHttpServer, request } from "node:http";
import {
  connect,
  createServer as createTcpServer,
  type Server,
} from "node:net";
import { createHttpProxyServer, createTcpForwardServer } from "./servers.js";

describe("egress servers", () => {
  it("forwards HTTP without proxy credentials", async () => {
    let receivedProxyAuthorization: string | undefined;
    const upstream = createHttpServer((incoming, response) => {
      receivedProxyAuthorization = incoming.headers["proxy-authorization"] as
        string | undefined;
      response.end("forwarded");
    });
    const upstreamPort = await listen(upstream);
    const proxy = createHttpProxyServer(async () => "127.0.0.1");
    const proxyPort = await listen(proxy);

    try {
      const result = await new Promise<{ status: number; body: string }>(
        (resolve, reject) => {
          const outgoing = request(
            {
              host: "127.0.0.1",
              port: proxyPort,
              path: `http://example.test:${upstreamPort}/resource`,
              headers: { "proxy-authorization": "synthetic" },
            },
            (response) => {
              const chunks: Buffer[] = [];
              response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
              response.on("end", () =>
                resolve({
                  status: response.statusCode ?? 0,
                  body: Buffer.concat(chunks).toString("utf8"),
                }),
              );
            },
          );
          outgoing.on("error", reject);
          outgoing.end();
        },
      );

      expect(result).toEqual({ status: 200, body: "forwarded" });
      expect(receivedProxyAuthorization).toBeUndefined();
    } finally {
      await Promise.all([close(proxy), close(upstream)]);
    }
  });

  it("forwards raw TCP only to its configured target", async () => {
    const upstream = createTcpServer((socket) => socket.pipe(socket));
    const upstreamPort = await listen(upstream);
    const forward = createTcpForwardServer(
      {
        listenPort: 15432,
        hostname: "database.example",
        port: upstreamPort,
      },
      async (hostname, port) => {
        expect({ hostname, port }).toEqual({
          hostname: "database.example",
          port: upstreamPort,
        });
        return "127.0.0.1";
      },
    );
    const forwardPort = await listen(forward);

    try {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = connect(forwardPort, "127.0.0.1", () =>
          socket.write("ping"),
        );
        socket.on("error", reject);
        socket.once("data", (data) => {
          resolve(data.toString("utf8"));
          socket.end();
        });
      });

      expect(response).toBe("ping");
    } finally {
      await Promise.all([close(forward), close(upstream)]);
    }
  });

  it("establishes CONNECT tunnels on configured custom ports", async () => {
    const upstream = createTcpServer((socket) => socket.pipe(socket));
    const upstreamPort = await listen(upstream);
    const proxy = createHttpProxyServer(async (hostname, port) => {
      expect({ hostname, port }).toEqual({
        hostname: "secure.example",
        port: upstreamPort,
      });
      return "127.0.0.1";
    });
    const proxyPort = await listen(proxy);

    try {
      const response = await new Promise<string>((resolve, reject) => {
        const outgoing = request({
          host: "127.0.0.1",
          port: proxyPort,
          method: "CONNECT",
          path: `secure.example:${upstreamPort}`,
        });
        outgoing.on("connect", (_response, socket) => {
          socket.once("data", (data) => {
            resolve(data.toString("utf8"));
            socket.end();
          });
          socket.write("ping");
        });
        outgoing.on("error", reject);
        outgoing.end();
      });

      expect(response).toBe("ping");
    } finally {
      await Promise.all([close(proxy), close(upstream)]);
    }
  });
});

function listen(server: Server | import("node:http").Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not bind to a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server | import("node:http").Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
