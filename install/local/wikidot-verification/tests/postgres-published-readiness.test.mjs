import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import {
  probePublishedPostgres,
  waitForPublishedPostgres,
} from "../src/postgres-published-readiness.mjs";

const SSL_REQUEST = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f]);

async function listen(handler) {
  const server = net.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  return {server, port: address.port};
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("published PostgreSQL probe verifies the SSLRequest protocol response", async () => {
  let request;
  const {server, port} = await listen((socket) => {
    socket.once("data", (chunk) => {
      request = chunk;
      socket.end(Buffer.from("N"));
    });
  });
  try {
    assert.equal(await probePublishedPostgres({port, timeoutMs: 100}), "N");
    assert.deepEqual(request, SSL_REQUEST);
  } finally {
    await close(server);
  }
});

test("published PostgreSQL readiness retries an invalid first protocol response", async () => {
  let connections = 0;
  const {server, port} = await listen((socket) => {
    connections += 1;
    socket.once("data", () => socket.end(Buffer.from([connections === 1 ? 0x00 : 0x4e])));
  });
  try {
    assert.equal(await waitForPublishedPostgres({port, attempts: 3, intervalMs: 1, timeoutMs: 100}), "N");
    assert.equal(connections, 2);
  } finally {
    await close(server);
  }
});

test("published PostgreSQL readiness retries a host-path timeout", async () => {
  let connections = 0;
  const sockets = new Set();
  const {server, port} = await listen((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", () => {
      if (connections > 1) socket.end(Buffer.from("N"));
    });
  });
  try {
    assert.equal(await waitForPublishedPostgres({port, attempts: 3, intervalMs: 1, timeoutMs: 20}), "N");
    assert.equal(connections, 2);
  } finally {
    for (const socket of sockets) socket.destroy();
    await close(server);
  }
});

test("published PostgreSQL probe rejects a non-protocol byte", async () => {
  const {server, port} = await listen((socket) => {
    socket.once("data", () => socket.end(Buffer.from([0x00])));
  });
  try {
    await assert.rejects(
      probePublishedPostgres({port, timeoutMs: 100}),
      /unexpected PostgreSQL SSLRequest response: 0x00/u,
    );
  } finally {
    await close(server);
  }
});
