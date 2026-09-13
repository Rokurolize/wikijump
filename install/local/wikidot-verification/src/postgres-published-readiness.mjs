import net from "node:net";

const POSTGRES_SSL_REQUEST = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f]);

export function probePublishedPostgres({
  host = "127.0.0.1",
  port,
  timeoutMs = 500,
} = {}) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid PostgreSQL readiness port: ${port}`);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid PostgreSQL readiness timeout: ${timeoutMs}`);
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host, port});
    let settled = false;

    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(response);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => socket.write(POSTGRES_SSL_REQUEST));
    socket.once("data", (chunk) => {
      const response = chunk[0];
      if (response === 0x4e || response === 0x53) {
        finish(undefined, String.fromCharCode(response));
        return;
      }
      const display = response === undefined ? "empty response" : `0x${response.toString(16).padStart(2, "0")}`;
      finish(new Error(`unexpected PostgreSQL SSLRequest response: ${display}`));
    });
    socket.once("timeout", () => finish(new Error(`PostgreSQL SSLRequest timed out after ${timeoutMs}ms`)));
    socket.once("error", (error) => finish(error));
    socket.once("end", () => finish(new Error("PostgreSQL SSLRequest connection ended before a response")));
  });
}

export async function waitForPublishedPostgres({
  host = "127.0.0.1",
  port,
  attempts = 60,
  intervalMs = 250,
  timeoutMs = 500,
} = {}) {
  if (!Number.isInteger(attempts) || attempts <= 0) {
    throw new Error(`invalid PostgreSQL readiness attempt count: ${attempts}`);
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 0) {
    throw new Error(`invalid PostgreSQL readiness interval: ${intervalMs}`);
  }

  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await probePublishedPostgres({host, port, timeoutMs});
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts && intervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  }
  throw new Error(
    `published PostgreSQL ${host}:${port} did not become protocol-ready: ${lastError?.message ?? "unknown error"}`,
  );
}
