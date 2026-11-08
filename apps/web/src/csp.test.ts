import { expect, test } from "bun:test";

const html = await Bun.file(new URL("../index.html", import.meta.url)).text();

function policy(): string {
  const tag = html.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i)?.[0] ?? "";
  return tag.match(/content="([^"]*)"/i)?.[1] ?? "";
}

function directive(policyValue: string, name: string): string | undefined {
  return policyValue
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.split(/\s+/)[0] === name);
}

const contentSecurityPolicy = policy();

test("index.html carries a content security policy", () => {
  expect(contentSecurityPolicy).not.toBe("");
});

test.each([
  ["default-src", "default-src 'self'"],
  ["script-src", "script-src 'self'"],
  ["style-src", "style-src 'self' 'unsafe-inline'"],
  ["img-src", "img-src 'self' data:"],
  ["font-src", "font-src 'self' data:"],
  ["connect-src", "connect-src 'self' https: ws:"],
  ["object-src", "object-src 'none'"],
  ["base-uri", "base-uri 'none'"],
  ["form-action", "form-action 'self'"],
  ["frame-ancestors", "frame-ancestors 'none'"],
])("%s is present with the expected value", (name, expected) => {
  expect(directive(contentSecurityPolicy, name)).toBe(expected);
});

test("script-src allows neither inline nor eval", () => {
  const value = directive(contentSecurityPolicy, "script-src") ?? "";
  expect(value).not.toContain("unsafe-inline");
  expect(value).not.toContain("unsafe-eval");
});
