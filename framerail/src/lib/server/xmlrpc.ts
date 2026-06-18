import { Buffer } from "node:buffer"

type XmlRpcScalar = string | number | boolean | null
export type XmlRpcValue = XmlRpcScalar | XmlRpcValue[] | { [key: string]: XmlRpcValue }

interface XmlRpcCall {
  methodName: string
  params: XmlRpcValue[]
}

interface XmlElement {
  content: string
  end: number
  selfClosing: boolean
}

interface BasicAuthCredentials {
  username: string
  password: string
}

const XML_RPC_HEADERS = {
  "content-type": "text/xml; charset=utf-8"
}

const SYSTEM_METHODS = ["system.listMethods"]

class XmlRpcFault extends Error {
  constructor(
    readonly faultCode: number,
    readonly faultString: string,
    readonly httpStatus = 200,
    readonly headers: Record<string, string> = {}
  ) {
    super(faultString)
  }
}

export async function handleXmlRpcRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return faultResponse(new XmlRpcFault(405, "XML-RPC endpoint requires POST", 405))
  }

  const auth = parseBasicAuth(request.headers.get("authorization"))
  if (!auth) {
    return faultResponse(
      new XmlRpcFault(401, "Missing or invalid HTTP Basic authentication", 401, {
        "www-authenticate": 'Basic realm="Wikijump XML-RPC"'
      })
    )
  }

  try {
    const call = parseXmlRpcCall(await request.text())
    const result = await dispatchXmlRpcCall(call, auth)
    return xmlResponse(serializeMethodResponse(result))
  } catch (error) {
    if (error instanceof XmlRpcFault) {
      return faultResponse(error)
    }

    return faultResponse(new XmlRpcFault(-32700, "Malformed XML-RPC request"))
  }
}

async function dispatchXmlRpcCall(
  call: XmlRpcCall,
  _auth: BasicAuthCredentials
): Promise<XmlRpcValue> {
  switch (call.methodName) {
    case "system.listMethods":
      return SYSTEM_METHODS
    default:
      throw new XmlRpcFault(-32601, `Unsupported XML-RPC method: ${call.methodName}`)
  }
}

function parseBasicAuth(header: string | null): BasicAuthCredentials | null {
  if (!header?.startsWith("Basic ")) {
    return null
  }

  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8")
    const separator = decoded.indexOf(":")
    if (separator <= 0 || separator === decoded.length - 1) {
      return null
    }

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    }
  } catch (_) {
    return null
  }
}

function parseXmlRpcCall(xml: string): XmlRpcCall {
  const normalized = stripIgnorableXml(xml)
  const methodCall = extractRequiredElement(normalized, "methodCall")
  const methodName = decodeXmlText(
    extractRequiredElement(methodCall.content, "methodName").content
  ).trim()
  if (methodName.length === 0) {
    throw new XmlRpcFault(-32600, "XML-RPC methodName must not be empty")
  }

  const paramsElement = extractOptionalElement(methodCall.content, "params")
  if (!paramsElement || paramsElement.selfClosing) {
    return { methodName, params: [] }
  }

  const params: XmlRpcValue[] = []
  let offset = 0
  while (true) {
    const param = extractOptionalElement(paramsElement.content, "param", offset)
    if (!param) {
      break
    }

    const value = extractRequiredElement(param.content, "value")
    params.push(parseXmlRpcValue(value.content))
    offset = param.end
  }

  return { methodName, params }
}

function parseXmlRpcValue(valueContent: string): XmlRpcValue {
  const text = valueContent.trim()
  if (!text.startsWith("<")) {
    return decodeXmlText(text)
  }

  if (isSelfClosingElement(text, "nil")) {
    return null
  }

  const stringElement = extractFirstDirectElement(text, "string")
  if (stringElement) {
    return decodeXmlText(stringElement.content)
  }

  const intElement =
    extractFirstDirectElement(text, "int") ?? extractFirstDirectElement(text, "i4")
  if (intElement) {
    const value = Number.parseInt(decodeXmlText(intElement.content).trim(), 10)
    if (!Number.isFinite(value)) {
      throw new XmlRpcFault(-32602, "Invalid XML-RPC integer value")
    }
    return value
  }

  const booleanElement = extractFirstDirectElement(text, "boolean")
  if (booleanElement) {
    const value = decodeXmlText(booleanElement.content).trim()
    if (value === "1") return true
    if (value === "0") return false
    throw new XmlRpcFault(-32602, "Invalid XML-RPC boolean value")
  }

  const doubleElement = extractFirstDirectElement(text, "double")
  if (doubleElement) {
    const value = Number.parseFloat(decodeXmlText(doubleElement.content).trim())
    if (!Number.isFinite(value)) {
      throw new XmlRpcFault(-32602, "Invalid XML-RPC double value")
    }
    return value
  }

  const base64Element = extractFirstDirectElement(text, "base64")
  if (base64Element) {
    return decodeXmlText(base64Element.content).trim()
  }

  const dateElement = extractFirstDirectElement(text, "dateTime.iso8601")
  if (dateElement) {
    return decodeXmlText(dateElement.content).trim()
  }

  const arrayElement = extractFirstDirectElement(text, "array")
  if (arrayElement) {
    const dataElement = extractRequiredElement(arrayElement.content, "data")
    const values: XmlRpcValue[] = []
    let offset = 0
    while (true) {
      const item = extractOptionalElement(dataElement.content, "value", offset)
      if (!item) {
        break
      }
      values.push(parseXmlRpcValue(item.content))
      offset = item.end
    }
    return values
  }

  const structElement = extractFirstDirectElement(text, "struct")
  if (structElement) {
    const values: { [key: string]: XmlRpcValue } = {}
    let offset = 0
    while (true) {
      const member = extractOptionalElement(structElement.content, "member", offset)
      if (!member) {
        break
      }

      const name = decodeXmlText(extractRequiredElement(member.content, "name").content)
      const value = extractRequiredElement(member.content, "value")
      values[name] = parseXmlRpcValue(value.content)
      offset = member.end
    }
    return values
  }

  throw new XmlRpcFault(-32602, "Unsupported XML-RPC value type")
}

function extractFirstDirectElement(text: string, tagName: string): XmlElement | null {
  const trimmed = text.trim()
  const element = extractOptionalElement(trimmed, tagName)
  if (!element) {
    return null
  }

  const prefix = trimmed.slice(0, trimmed.indexOf(`<${tagName}`)).trim()
  return prefix.length === 0 ? element : null
}

function extractRequiredElement(text: string, tagName: string, offset = 0): XmlElement {
  const element = extractOptionalElement(text, tagName, offset)
  if (!element) {
    throw new XmlRpcFault(-32600, `Missing XML-RPC <${tagName}> element`)
  }
  return element
}

function extractOptionalElement(
  text: string,
  tagName: string,
  offset = 0
): XmlElement | null {
  const openPattern = new RegExp(
    `<${escapeRegExp(tagName)}(?:\\s[^>]*)?>|<${escapeRegExp(tagName)}\\s*/>`,
    "g"
  )
  openPattern.lastIndex = offset
  const match = openPattern.exec(text)
  if (!match) {
    return null
  }

  const opening = match[0]
  const contentStart = match.index + opening.length
  if (opening.endsWith("/>")) {
    return { content: "", end: contentStart, selfClosing: true }
  }

  const tagPattern = new RegExp(
    `</?${escapeRegExp(tagName)}(?:\\s[^>]*)?>|<${escapeRegExp(tagName)}\\s*/>`,
    "g"
  )
  tagPattern.lastIndex = contentStart
  let depth = 1

  while (true) {
    const tagMatch = tagPattern.exec(text)
    if (!tagMatch) {
      throw new XmlRpcFault(-32600, `Unclosed XML-RPC <${tagName}> element`)
    }

    const tag = tagMatch[0]
    if (tag.startsWith(`</${tagName}`)) {
      depth -= 1
      if (depth === 0) {
        return {
          content: text.slice(contentStart, tagMatch.index),
          end: tagPattern.lastIndex,
          selfClosing: false
        }
      }
    } else if (!tag.endsWith("/>")) {
      depth += 1
    }
  }
}

function isSelfClosingElement(text: string, tagName: string): boolean {
  return new RegExp(`^<${escapeRegExp(tagName)}\\s*/>$`).test(text)
}

function stripIgnorableXml(xml: string): string {
  return xml
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[\s\S]*?\?>/i, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim()
}

function serializeMethodResponse(value: XmlRpcValue): string {
  return xmlDocument(
    `<methodResponse><params><param>${serializeValue(value)}</param></params></methodResponse>`
  )
}

function serializeFault(fault: XmlRpcFault): string {
  return xmlDocument(
    `<methodResponse><fault>${serializeValue({
      faultCode: fault.faultCode,
      faultString: fault.faultString
    })}</fault></methodResponse>`
  )
}

function serializeValue(value: XmlRpcValue): string {
  if (value === null) {
    return "<value><nil /></value>"
  }

  if (Array.isArray(value)) {
    return `<value><array><data>${value.map(serializeValue).join("")}</data></array></value>`
  }

  switch (typeof value) {
    case "string":
      return `<value><string>${escapeXmlText(value)}</string></value>`
    case "number":
      if (Number.isInteger(value)) {
        return `<value><int>${value}</int></value>`
      }
      return `<value><double>${value}</double></value>`
    case "boolean":
      return `<value><boolean>${value ? "1" : "0"}</boolean></value>`
    case "object":
      return `<value><struct>${Object.entries(value)
        .map(
          ([key, memberValue]) =>
            `<member><name>${escapeXmlText(key)}</name>${serializeValue(memberValue)}</member>`
        )
        .join("")}</struct></value>`
  }
}

function faultResponse(fault: XmlRpcFault): Response {
  return xmlResponse(serializeFault(fault), fault.httpStatus, fault.headers)
}

function xmlResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(body, {
    status,
    headers: {
      ...XML_RPC_HEADERS,
      ...headers
    }
  })
}

function xmlDocument(body: string): string {
  return `<?xml version="1.0"?>${body}`
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
