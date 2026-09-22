// Unix-socket daemon lifecycle helpers.
//
// A theme-lab session survives across CLI invocations, so start/stop must be
// robust to stale sockets and orphaned PID files left by a killed process.

import fs from "node:fs/promises";
import net from "node:net";

import {ThemeLabError, fail} from "./errors.mjs";

const SOCKET_PROBE_TIMEOUT_MS = 500;

export function pidPathFor(socketPath) {
  return `${socketPath}.pid`;
}

// "live"    - something is accepting connections
// "stale"   - a socket file exists but refuses connections
// "absent"  - no socket file
export async function socketState(socketPath) {
  try {
    await fs.access(socketPath);
  } catch {
    return "absent";
  }
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    let settled = false;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(state);
    };
    socket.once("connect", () => finish("live"));
    socket.once("error", (error) => finish(error.code === "ECONNREFUSED" ? "stale" : "stale"));
    const timer = setTimeout(() => finish("stale"), SOCKET_PROBE_TIMEOUT_MS);
    timer.unref?.();
  });
}

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export async function readPidFile(socketPath) {
  try {
    const raw = await fs.readFile(pidPathFor(socketPath), "utf8");
    const pid = Number.parseInt(raw.trim(), 10);
    return Number.isSafeInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

export async function writePidFile(socketPath, pid = process.pid) {
  const target = pidPathFor(socketPath);
  const temporary = `${target}.${pid}.tmp`;
  await fs.writeFile(temporary, `${pid}\n`, {mode: 0o600});
  await fs.rename(temporary, target);
  return target;
}

export async function removePidFile(socketPath) {
  await fs.rm(pidPathFor(socketPath), {force: true});
}

// Refuse to start a second daemon on a live socket, and clear a stale one.
export async function prepareSocketForStart(socketPath) {
  const state = await socketState(socketPath);
  if (state === "live") {
    const pid = await readPidFile(socketPath);
    fail("socket_in_use", `theme-lab session already listening on ${socketPath}`, {socket: socketPath, pid});
  }
  await fs.rm(socketPath, {force: true});
  await removePidFile(socketPath);
  return state;
}

export async function stopDaemon(socketPath, {timeoutMs = 5_000} = {}) {
  const state = await socketState(socketPath);
  const pid = await readPidFile(socketPath);
  if (state === "live" && pid && processAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await socketState(socketPath)) !== "live") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if ((await socketState(socketPath)) === "live") {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
  await fs.rm(socketPath, {force: true});
  await removePidFile(socketPath);
  return {stopped: true, previous_state: state, pid};
}

export function assertSocketPath(value) {
  if (typeof value !== "string" || !value) throw new ThemeLabError("invalid_socket_path", "socket path is required");
  return value;
}
