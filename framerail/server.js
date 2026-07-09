import http from "node:http"

import { createArticleResponseFastPathHandler } from "./article-response-fast-path.js"
import { handler } from "./build/handler.js"
import { createRedisCacheStore } from "./src/lib/server/redis-cache-store.js"

const path = process.env.SOCKET_PATH
const host = process.env.HOST ?? "0.0.0.0"
const port = process.env.PORT ?? "3000"
const store = createRedisCacheStore()
const fastPathHandler = createArticleResponseFastPathHandler({ store, handler })

const server = http.createServer((request, response) => {
  void fastPathHandler(request, response).catch((error) => {
    response.statusCode = 500
    response.end(error instanceof Error ? error.message : "Internal Server Error")
  })
})

server.listen(path ? { path } : { host, port }, () => {
  console.log(`Listening on ${path || `http://${host}:${port}`}`)
})

const closeServer = () => {
  server.close()
}

process.on("SIGTERM", closeServer)
process.on("SIGINT", closeServer)
