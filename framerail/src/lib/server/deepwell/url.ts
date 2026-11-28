export const urlHost = (host: string): string => {
  const bracketed = host.startsWith("[") && host.endsWith("]")
  return host.includes(":") && !bracketed ? `[${host}]` : host
}

export const deepwellJsonRpcUrl = (host: string, port: string | number): string =>
  `http://${urlHost(host)}:${port}/jsonrpc`
