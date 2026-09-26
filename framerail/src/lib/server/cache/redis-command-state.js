import { RedisResponseDecoder } from "./redis-response-decoder.js"
import { RedisRequestQueue } from "./redis-request-queue.js"
import { encodeRedisCommand } from "./redis-protocol.js"

/**
 * @typedef {object} PendingRedisRequest
 * @property {(value: unknown) => void} resolve
 * @property {(error: Error) => void} reject
 */
/**
 * @typedef {object} RedisCommandState
 * @property {import("node:net").Socket | import("node:tls").TLSSocket | null} socket
 * @property {RedisResponseDecoder} decoder
 * @property {RedisRequestQueue<PendingRedisRequest>} pending
 */

/** @returns {RedisCommandState} */
export const createRedisCommandState = () => ({
  socket: null,
  decoder: new RedisResponseDecoder(),
  pending: new RedisRequestQueue()
})

/**
 * @param {{
 *   state: RedisCommandState
 *   socket: import("node:net").Socket | import("node:tls").TLSSocket
 *   onData: (chunk: Buffer) => void
 *   onDisconnect: () => void
 * }} input
 */
export const attachRedisCommandSocket = ({ state, socket, onData, onDisconnect }) => {
  state.socket = socket
  state.decoder = new RedisResponseDecoder()
  socket.on("data", onData)
  const disconnectIfCurrent = () => {
    if (state.socket === socket) onDisconnect()
  }
  socket.on("error", disconnectIfCurrent)
  socket.on("close", disconnectIfCurrent)
}

/**
 * @param {RedisCommandState} state
 * @param {string} closedMessage
 */
export const resetRedisCommandState = (state, closedMessage) => {
  const socket = state.socket
  state.socket = null
  state.decoder = new RedisResponseDecoder()
  const pending = state.pending
  state.pending = new RedisRequestQueue()
  if (socket && !socket.destroyed) socket.destroy()
  for (let request; (request = pending.shift());) {
    request.reject(new Error(closedMessage))
  }
}

/**
 * @param {{
 *   state: RedisCommandState
 *   parts: (string | number)[]
 *   timeoutMs: number
 *   unavailableMessage: string
 *   timeoutMessage: string
 *   onTimeout: () => void
 * }} input
 * @returns {Promise<unknown>}
 * @throws {Error} If the Redis socket is unavailable; the returned promise
 *   also rejects on timeout or write failure.
 */
export const writeRedisCommand = ({
  state,
  parts,
  timeoutMs,
  unavailableMessage,
  timeoutMessage,
  onTimeout
}) => {
  const socket = state.socket
  if (!socket || socket.destroyed) throw new Error(unavailableMessage)

  const queue = state.pending
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      queue.remove(pendingNode)
      reject(new Error(timeoutMessage))
      onTimeout()
    }, timeoutMs)
    /** @type {PendingRedisRequest} */
    const pendingRequest = {
      resolve: (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    }
    const pendingNode = queue.push(pendingRequest)
    socket.write(encodeRedisCommand(parts), "utf8", (error) => {
      if (!error) return
      queue.remove(pendingNode)
      pendingRequest.reject(error)
    })
  })
}
