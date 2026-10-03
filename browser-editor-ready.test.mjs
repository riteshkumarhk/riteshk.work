import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { waitForSlideEditor } from "./tools/browser-editor-ready.mjs";

function pageFixture(operation) {
  const page = new EventEmitter();
  let calls = 0;
  page.evaluate = () => ++calls === 1 ? operation() : Promise.resolve({ document: "complete", apiReady: false, busy: true });
  return page;
}

test("editor readiness awaits the real completion and cleans up listeners", async () => {
  let complete;
  const page = pageFixture(() => new Promise(resolve => { complete = resolve; }));
  const waiting = waitForSlideEditor(page);
  assert.equal(page.listenerCount("pageerror"), 1);
  complete();
  await waiting;
  assert.equal(page.listenerCount("pageerror"), 0);
});

test("editor readiness reports a rejected startup immediately with its cause and snapshot", async () => {
  const failure = new Error("Unsupported deck format");
  const page = pageFixture(() => Promise.reject(failure));
  await assert.rejects(waitForSlideEditor(page), error => {
    assert.equal(error.cause, failure);
    assert.match(error.message, /Unsupported deck format/);
    assert.match(error.message, /"busy":true/);
    return true;
  });
  assert.equal(page.listenerCount("pageerror"), 0);
});

test("editor readiness fails on browser errors instead of waiting for its deadline", async () => {
  const page = pageFixture(() => new Promise(() => {}));
  const waiting = waitForSlideEditor(page);
  page.emit("pageerror", new Error("Editor module initialization failed"));
  await assert.rejects(waiting, /Editor module initialization failed/);
  assert.equal(page.listenerCount("pageerror"), 0);
});

test("editor readiness bounds a genuinely stalled boot and retains diagnostic failures", async () => {
  const page = pageFixture(() => new Promise(() => {}));
  await assert.rejects(waitForSlideEditor(page, { timeout: 10 }), /startup exceeded 10ms.*\nStartup:/);
  assert.equal(page.listenerCount("pageerror"), 0);
  const unavailable = new EventEmitter();
  unavailable.evaluate = () => Promise.reject(new Error("Browser disconnected"));
  await assert.rejects(waitForSlideEditor(unavailable), error => {
    assert.match(error.message, /Browser disconnected/);
    assert.match(error.message, /"unavailable"/);
    return true;
  });

});

test("an unresponsive renderer cannot make failure diagnostics hang indefinitely", async () => {
  const page = new EventEmitter();
  page.evaluate = () => new Promise(() => {});
  await assert.rejects(waitForSlideEditor(page, { timeout: 10 }), /snapshot did not respond within 1000ms/);
  assert.equal(page.listenerCount("pageerror"), 0);
});
