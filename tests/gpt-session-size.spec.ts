import { test, expect } from "@playwright/test";
import { extractGptSession, GPT_SESSION_MAX_BYTES } from "../src/gptSession";
import { parseGptSessionBatch } from "../src/gptBatch";

test("GPT batch Session size accepts the expanded auth-session response", () => {
  const session = { WARNING_BANNER: "test banner", accessToken: "test-access-token", sessionToken: "test-session-token", user: { email: "size@example.test" }, marketingEligibility: { sample: { events: { padding: "x".repeat(33_000) } } } };
  const raw = JSON.stringify(session);
  expect(new TextEncoder().encode(raw).length).toBeGreaterThan(32 * 1024);
  expect(extractGptSession(raw)).toEqual(session);
  expect(parseGptSessionBatch(raw).accounts[0]?.session).toBe(raw);
  expect(extractGptSession(`account----password----${raw}`)).toEqual(session);
});

test("GPT batch Session size remains bounded in UTF-8 bytes", () => {
  const small = { accessToken: "test-access-token", sessionToken: "test-session-token", extra: "" };
  const overhead = new TextEncoder().encode(JSON.stringify(small)).length;
  const exact = JSON.stringify({ ...small, extra: "x".repeat(64 * 1024 - overhead) });
  expect(extractGptSession(exact)).not.toBeNull();
  expect(extractGptSession(exact + " ")).not.toBeNull(); // Outer whitespace is trimmed.
  expect(extractGptSession(JSON.stringify({ ...small, extra: "x".repeat(64 * 1024 - overhead + 1) }))).toBeNull();
  expect(extractGptSession(JSON.stringify({ ...small, extra: "汉".repeat(24_000) }))).toBeNull();
  expect(GPT_SESSION_MAX_BYTES).toBe(64 * 1024);
});

test("GPT batch Session size keeps missing and expired credentials rejected", () => {
  expect(extractGptSession(JSON.stringify({ accessToken: "test", marketingEligibility: "x".repeat(33_000) }))).toBeNull();
  expect(parseGptSessionBatch(JSON.stringify({ accessToken: "test", sessionToken: "test", error: "RefreshAccessTokenError", marketingEligibility: "x".repeat(33_000) })).error?.code).toBe("expired");
});
