/**
 * @template T
 * @typedef {object} RequestNode
 * @property {T} value
 * @property {RequestNode<T> | null} previous
 * @property {RequestNode<T> | null} next
 * @property {boolean} active
 */

/**
 * FIFO with constant-time removal by handle. Unlike an array, draining or
 * cancelling a pipeline never moves/scans the other pending requests.
 *
 * @template T
 */
export class RedisRequestQueue {
  /** @type {RequestNode<T> | null} */
  head = null
  /** @type {RequestNode<T> | null} */
  tail = null
  length = 0

  /** @param {T} value */
  push(value) {
    /** @type {RequestNode<T>} */
    const node = { value, previous: this.tail, next: null, active: true }
    if (this.tail) this.tail.next = node
    else this.head = node
    this.tail = node
    this.length += 1
    return node
  }

  /** @param {RequestNode<T>} node */
  remove(node) {
    if (!node.active) return
    if (node.previous) node.previous.next = node.next
    else this.head = node.next
    if (node.next) node.next.previous = node.previous
    else this.tail = node.previous
    node.active = false
    node.previous = null
    node.next = null
    this.length -= 1
  }

  shift() {
    const node = this.head
    if (!node) return undefined
    this.remove(node)
    return node.value
  }
}
