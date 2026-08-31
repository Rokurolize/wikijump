import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import { pipeline } from "node:stream";

const METADATA = new Set(["169.254.169.254", "100.100.100.200"]);
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class CaptureEgressError extends Error {}

function normalizeIp(address) {
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

export function isBlockedAddress(raw) {
  const address = normalizeIp(raw).toLowerCase();
  if (METADATA.has(address)) return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (!net.isIPv6(address)) return true;
  return (
    address === "::" ||
    address === "::1" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    address.startsWith("fe8") ||
    address.startsWith("fe9") ||
    address.startsWith("fea") ||
    address.startsWith("feb") ||
    address.startsWith("ff")
  );
}

function authority(hostname, port) {
  return `${hostname.toLowerCase()}:${port}`;
}

function targetKey(protocol, hostname, port) {
  return `${protocol}//${authority(hostname, port)}`;
}

function parseAuthority(value, defaultPort) {
  let url;
  try {
    url = new URL(`https://${value}`);
  } catch {
    throw new CaptureEgressError("invalid proxy authority");
  }
  if (url.username || url.password || url.pathname !== "/") {
    throw new CaptureEgressError("invalid proxy authority");
  }
  return { hostname: url.hostname, port: Number(url.port || defaultPort) };
}

export async function resolvePinned(
  hostname,
  port,
  { lookup, protocol = "http:", allowedTargets = new Set() },
) {
  const allowed = allowedTargets.has(targetKey(protocol, hostname, port));
  let rows;
  try {
    rows = net.isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new CaptureEgressError("destination resolution failed");
  }
  if (!rows.length)
    throw new CaptureEgressError(
      "destination resolution returned no addresses",
    );
  const addresses = rows.map(({ address }) => normalizeIp(address));
  if (!allowed && addresses.some(isBlockedAddress)) {
    throw new CaptureEgressError(
      "destination address is not publicly routable",
    );
  }
  return addresses[0];
}

function deny(response, status = 403) {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, {
    "content-type": "text/plain",
    connection: "close",
  });
  response.end("capture egress denied\n");
}

export function guardedPipeline(source, destination, onFailure, pipelineImpl = pipeline) {
  try {
    pipelineImpl(source, destination, (error) => {
      if (error) onFailure(error);
    });
  } catch (error) {
    onFailure(error);
  }
}

export async function startCaptureEgressProxy({
  allowedLocalOrigins = [],
  lookup = dns.lookup,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new CaptureEgressError("proxy request timeout must be a positive safe integer");
  }
  const allowedTargets = new Set();
  const activeSockets = new Set();
  for (const raw of allowedLocalOrigins) {
    const url = new URL(raw);
    if (
      !new Set(["http:", "https:"]).has(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new CaptureEgressError(
        "local allowlist entries must be HTTP(S) origins",
      );
    }
    if (url.origin !== raw.replace(/\/$/u, "")) {
      throw new CaptureEgressError(
        "local allowlist entries must be exact origins",
      );
    }
    allowedTargets.add(
      targetKey(
        url.protocol,
        url.hostname,
        Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      ),
    );
  }

  const server = http.createServer(async (request, response) => {
    let target;
    try {
      target = new URL(request.url);
      if (target.protocol !== "http:" || target.username || target.password)
        throw new Error();
      const port = Number(target.port || 80);
      const address = await resolvePinned(target.hostname, port, {
        lookup,
        protocol: "http:",
        allowedTargets,
      });
      const headers = { ...request.headers, host: target.host };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = http.request(
        {
          host: address,
          port,
          method: request.method,
          path: `${target.pathname}${target.search}`,
          headers,
          family: net.isIPv6(address) ? 6 : 4,
        },
        (upstreamResponse) => {
          upstreamResponse.on("error", () => response.destroy());
          response.on("error", () => upstreamResponse.destroy());
          response.writeHead(
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.headers,
          );
          guardedPipeline(upstreamResponse, response, (error) => {
            if (error) {
              upstreamResponse.destroy();
              response.destroy();
            }
          });
        },
      );
      upstream.setTimeout(requestTimeoutMs, () => {
        upstream.destroy(new CaptureEgressError("proxy upstream request timed out"));
      });
      upstream.on("error", () => deny(response, 502));
      request.on("error", () => upstream.destroy());
      guardedPipeline(request, upstream, (error) => {
        if (error) {
          upstream.destroy();
          deny(response, 502);
        }
      });
    } catch {
      deny(response);
    }
  });
  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.once("close", () => activeSockets.delete(socket));
  });

  server.on("connect", async (request, client, head) => {
    let upstream;
    let tunnelTimer = null;
    const closeTunnel = () => {
      if (tunnelTimer !== null) {
        clearTimeout(tunnelTimer);
        tunnelTimer = null;
      }
      client.destroy();
      upstream?.destroy();
    };
    const resetTunnelTimeout = () => {
      if (tunnelTimer !== null) clearTimeout(tunnelTimer);
      tunnelTimer = setTimeout(closeTunnel, requestTimeoutMs);
    };
    client.on("data", resetTunnelTimeout);
    resetTunnelTimeout();
    client.on("error", closeTunnel);
    client.on("close", () => upstream?.destroy());
    try {
      const { hostname, port } = parseAuthority(request.url, 443);
      const address = await resolvePinned(hostname, port, {
        lookup,
        protocol: "https:",
        allowedTargets,
      });
      if (client.destroyed) return;
      upstream = net.connect({
        host: address,
        port,
        family: net.isIPv6(address) ? 6 : 4,
      });
      resetTunnelTimeout();
      upstream.on("data", resetTunnelTimeout);
      upstream.on("error", closeTunnel);
      upstream.once("connect", () => {
        resetTunnelTimeout();
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => {
      for (const socket of activeSockets) socket.destroy();
      server.closeAllConnections?.();
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
