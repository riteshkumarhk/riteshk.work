import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresenterClock } from './src/js/presenter-clock.mjs';

test('pause excludes interruption time from deck and slide clocks', () => {
  let time = 0;
  const clock = createPresenterClock(() => time);
  time = 10000;
  clock.toggle();
  time = 90000;
  assert.equal(clock.elapsed(), 10000);
  assert.equal(clock.slideElapsed(), 10000);
  clock.toggle();
  time = 95000;
  assert.equal(clock.elapsed(), 15000);
  clock.nextSlide();
  time = 97000;
  assert.equal(clock.slideElapsed(), 2000);
  assert.equal(clock.elapsed(), 17000);
  clock.toggle();
  clock.reset();
  time = 99000;
  assert.equal(clock.elapsed(), 0);
  assert.equal(clock.paused, true);
  clock.toggle();
  time = 100000;
  assert.equal(clock.elapsed(), 1000);
});