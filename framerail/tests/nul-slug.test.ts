import { expect, test } from "@playwright/test"

test("a NUL byte in a page URL answers not found", async ({ request }) => {
  const response = await request.get("http://127.0.0.1:4173/scp-002%00", {
    headers: {
      "X-Wikijump-Site-Slug": "test",
      "X-Wikijump-Site-Id": "1"
    }
  })
  expect(response.status()).toBe(404)
})
