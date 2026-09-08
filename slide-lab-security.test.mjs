import test from "node:test";
import assert from "node:assert/strict";
import { stripUpstreamFirebase } from "./slide-lab-engine.mjs";

test("removes upstream Firebase config without changing unrelated build constants", () => {
  const source = `var env = { VITE_APP_FIREBASE_CONFIG: '{"apiKey":"test-placeholder","projectId":"upstream-dev"}', PKG_VERSION: "0.18.1" };`;
  const cleaned = stripUpstreamFirebase(source);
  assert.ok(!cleaned.includes("test-placeholder"));
  assert.ok(!cleaned.includes("upstream-dev"));
  assert.ok(cleaned.includes('VITE_APP_FIREBASE_CONFIG: "{}"'));
  assert.ok(cleaned.includes('PKG_VERSION: "0.18.1"'));
  assert.equal(stripUpstreamFirebase(cleaned), cleaned);
});