import test from "node:test";
import assert from "node:assert/strict";
import { videoSourcePoint, authoredVideoColor, videoAtPoint, drawVideoPixel } from "./src/js/slide-lab-video-sample.mjs";

test("video pixel mapping respects scaling, letterboxing and cover cropping", () => {
  assert.deepEqual(videoSourcePoint(640, 320, 320, 200, 160, 100), { x: 320, y: 160 });
  assert.equal(videoSourcePoint(640, 320, 320, 200, 160, 10), null);
  assert.deepEqual(videoSourcePoint(640, 320, 200, 200, 0, 100, "cover"), { x: 160, y: 160 });
  assert.deepEqual(videoSourcePoint(640, 320, 200, 200, 0, 100, "cover", "0% 50%"), { x: 0, y: 160 });
  assert.deepEqual(videoSourcePoint(640, 320, 200, 200, 100, 100, "fill"), { x: 320, y: 160 });
  assert.equal(videoSourcePoint(0, 0, 200, 200, 100, 100), null);
});
test("iframe hit testing maps scaled coordinates into the same-origin document", () => {
  const video = { tagName: "VIDEO" };
  const frame = { tagName: "IFRAME", classList: { contains: () => true }, offsetWidth: 640, offsetHeight: 320, clientLeft: 0, clientTop: 0, getBoundingClientRect: () => ({ left: 50, top: 100, width: 320, height: 160 }), contentDocument: { elementsFromPoint: (x, y) => { assert.equal(x, 100); assert.equal(y, 60); return [video]; } } };
  assert.deepEqual(videoAtPoint({ elementsFromPoint: () => [frame] }, 100, 130), { video, clientX: 100, clientY: 60 });
  frame.contentDocument = null;
  assert.deepEqual(videoAtPoint({ elementsFromPoint: () => [frame] }, 100, 130), { unavailable: true });
});
test("current video frame is read without seeking or changing playback", () => {
  const video = { readyState: 2, videoWidth: 640, videoHeight: 320, clientWidth: 320, clientHeight: 160, offsetWidth: 320, offsetHeight: 160, clientLeft: 0, clientTop: 0, currentTime: 1.25, paused: true, getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 160 }), ownerDocument: { defaultView: { getComputedStyle: () => ({ objectFit: "contain", objectPosition: "50% 50%" }) } } };
  const context = { drawImage(...args) { assert.deepEqual(args, [video, 200, 100, 1, 1, 0, 0, 1, 1]); } };
  assert.equal(drawVideoPixel(context, { video, clientX: 100, clientY: 50 }), true);
  assert.equal(video.currentTime, 1.25);
  assert.equal(video.paused, true);
  video.readyState = 1;
  assert.equal(drawVideoPixel(context, { video, clientX: 100, clientY: 50 }), false);
});
test("video colors stay unchanged in light rendering and compensate native dark rendering", () => {
  assert.deepEqual(authoredVideoColor([100, 150, 200], "none"), [100, 150, 200]);
  const target = [30, 44, 58];
  const authored = authoredVideoColor(target, "invert(0.93) hue-rotate(180deg)");
  const inverted = authored.map(channel => 0.93 * 255 - 0.86 * channel);
  const luminance = inverted[0] * 0.213 + inverted[1] * 0.715 + inverted[2] * 0.072;
  inverted.forEach((channel, index) => assert.ok(Math.abs(2 * luminance - channel - target[index]) <= 1));
});
test("inactive visible video embeds remain sampleable with pointer events disabled", () => {
  const video = { tagName: "VIDEO", getBoundingClientRect: () => ({ left: 20, top: 30, right: 120, bottom: 130 }) };
  const document = { elementsFromPoint: () => [], querySelectorAll: () => [video], defaultView: { getComputedStyle: () => ({ pointerEvents: "none", display: "block", visibility: "visible" }) } };
  assert.deepEqual(videoAtPoint(document, 50, 60), { video, clientX: 50, clientY: 60 });
  assert.equal(videoAtPoint(document, 150, 60), null);
});