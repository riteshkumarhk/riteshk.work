import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createPresenterFrameSource, guardPresenterFrameStartup } from "./src/js/presenter-frame-source.mjs";

const frame = id => ({ id, closed: 0, close() { this.closed++; } });

test("presenter frame source retains only the newest native frame and closes every frame once", async () => {
  let controller, canceled = 0;
  const readable = new ReadableStream({ start(value) { controller = value; }, cancel() { canceled++; } });
  const errors = [], processor = { readable }, source = createPresenterFrameSource(processor, error => errors.push(error));
  assert.equal(source.processor, processor);
  const first = frame(1), second = frame(2), third = frame(3);
  controller.enqueue(first);
  await nextTurn();
  assert.equal(source.frame, first);
  controller.enqueue(second); controller.enqueue(third);
  await nextTurn();
  assert.equal(source.frame, third);
  assert.deepEqual([first.closed, second.closed, third.closed], [1, 1, 0]);
  await source.dispose();
  await source.dispose();
  assert.deepEqual([first.closed, second.closed, third.closed], [1, 1, 1]);
  assert.equal(source.frame, null);
  assert.equal(source.processor, null);
  assert.equal(canceled, 1);
  assert.equal(readable.locked, false);
  assert.deepEqual(errors, []);
});

test("presenter frame source closes a late frame after cancellation without making it drawable", async () => {
  let resolveRead, cancellations = 0, releases = 0;
  const reader = {
    read: () => new Promise(resolve => { resolveRead = resolve; }),
    cancel: async () => { cancellations++; },
    releaseLock: () => { releases++; }
  };
  const errors = [], source = createPresenterFrameSource({ readable: { getReader: () => reader } }, error => errors.push(error));
  const disposing = source.dispose(), late = frame("late");
  resolveRead({ value: late, done: false });
  await disposing;
  assert.equal(late.closed, 1);
  assert.equal(source.frame, null);
  assert.equal(cancellations, 1);
  assert.equal(releases, 1);
  assert.deepEqual(errors, []);
});

test("presenter frame source reports failures and unexpected end instead of retaining a stale preview", async () => {
  for (const fail of [true, false]) {
    let controller;
    const readable = new ReadableStream({ start(value) { controller = value; } });
    const errors = [], source = createPresenterFrameSource({ readable }, error => errors.push(error));
    const current = frame("current"), failure = new Error("Synthetic read failure");
    controller.enqueue(current);
    await nextTurn();
    if (fail) controller.error(failure); else controller.close();
    await source.finished;
    assert.equal(errors.length, 1);
    if (fail) assert.equal(errors[0], failure); else assert.match(errors[0].message, /stream ended/);
    assert.equal(current.closed, 1);
    assert.equal(source.frame, null);
    assert.equal(readable.locked, false);
    await source.dispose();
  }
});

test("presenter frame source surfaces cancellation failure while releasing its lock", async () => {
  const failure = new Error("Synthetic cancellation failure");
  const readable = new ReadableStream({ cancel() { throw failure; } });
  const errors = [], source = createPresenterFrameSource({ readable }, error => errors.push(error));
  await assert.rejects(source.dispose(), failure);
  assert.equal(source.frame, null);
  assert.equal(readable.locked, false);
  assert.deepEqual(errors, []);
});

function startupFixture(overrides = {}) {
  const timers = new Map(), errors = [];
  let ready = false, current = true, refreshes = 0;
  const clock = {
    setTimeout(callback, delay) { timers.set(delay, callback); return delay; },
    clearTimeout(id) { timers.delete(id); }
  };
  const guard = guardPresenterFrameStartup({
    isCurrent: () => current, isReady: () => ready,
    refresh: async () => { refreshes++; },
    onError: error => errors.push(error), ...overrides
  }, clock);
  return {
    guard, timers, errors,
    get refreshes() { return refreshes; },
    ready() { ready = true; }, obsolete() { current = false; },
    async fire(delay) { const callback = timers.get(delay); timers.delete(delay); await callback?.(); }
  };
}

test("presenter startup does not delay or refresh a source that already delivered frames", async () => {
  const setup = startupFixture();
  setup.ready(); setup.guard.check();
  await setup.fire(1000); await setup.fire(5000);
  assert.equal(setup.refreshes, 0);
  assert.equal(setup.timers.size, 0);
  assert.deepEqual(setup.errors, []);
});

test("presenter startup refreshes a frameless source exactly once and accepts only actual frames", async () => {
  const setup = startupFixture();
  await setup.fire(1000); await setup.fire(1000);
  assert.equal(setup.refreshes, 1);
  assert.equal(setup.timers.has(5000), true);
  setup.ready(); setup.guard.check();
  await setup.fire(5000);
  assert.deepEqual(setup.errors, []);
});

test("presenter startup has a hard five-second failure cutoff without an endless recovery loop", async () => {
  const setup = startupFixture();
  await setup.fire(1000); await setup.fire(5000); await setup.fire(1000);
  assert.equal(setup.refreshes, 1);
  assert.equal(setup.errors.length, 1);
  assert.match(setup.errors[0].message, /frames did not arrive/);
  assert.equal(setup.timers.size, 0);
});

test("presenter startup cancellation and obsolete captures cannot refresh or fail a newer connection", async () => {
  for (const stop of ["dispose", "obsolete"]) {
    const setup = startupFixture();
    if (stop === "dispose") setup.guard.dispose(); else setup.obsolete();
    await setup.fire(1000); await setup.fire(5000);
    assert.equal(setup.refreshes, 0);
    assert.deepEqual(setup.errors, []);
  }
  let reject;
  const setup = startupFixture({ refresh: () => new Promise((_, fail) => { reject = fail; }) });
  const pending = setup.fire(1000);
  setup.guard.dispose();
  reject(new Error("Old capture ended"));
  await pending;
  assert.deepEqual(setup.errors, []);
  assert.equal(setup.timers.size, 0);
});

test("presenter startup surfaces native constraint failures without waiting for or repeating the deadline", async () => {
  const failure = new Error("Synthetic native refresh failure");
  const setup = startupFixture({ refresh: async () => { throw failure; } });
  await setup.fire(1000); await setup.fire(5000);
  assert.deepEqual(setup.errors, [failure]);
  assert.equal(setup.timers.size, 0);
});

test("presenter startup deadline still releases a capture when its native refresh promise never settles", async () => {
  let resolve;
  const setup = startupFixture({ refresh: () => new Promise(done => { resolve = done; }) });
  const pending = setup.fire(1000);
  await setup.fire(5000);
  assert.equal(setup.errors.length, 1);
  assert.match(setup.errors[0].message, /frames did not arrive/);
  assert.equal(setup.timers.size, 0);
  resolve();
  await pending;
  assert.equal(setup.errors.length, 1);
});
