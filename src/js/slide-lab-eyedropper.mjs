import { videoAtPoint, drawVideoPixel, authoredVideoColor } from "./slide-lab-video-sample.mjs";

export function sampleCanvasColor(canvas, clientX, clientY, visible = false) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const pixelX = Math.floor((clientX - rect.left) * canvas.width / rect.width);
  const pixelY = Math.floor((clientY - rect.top) * canvas.height / rect.height);
  if (pixelX < 0 || pixelY < 0 || pixelX >= canvas.width || pixelY >= canvas.height) return null;
  try {
    const sample = document.createElement("canvas");
    sample.width = sample.height = 1;
    const context = sample.getContext("2d", { willReadFrequently: true });
    let backdrop = canvas.parentElement;
    while (backdrop && ["transparent", "rgba(0, 0, 0, 0)"].includes(getComputedStyle(backdrop).backgroundColor)) backdrop = backdrop.parentElement;
    context.fillStyle = backdrop ? getComputedStyle(backdrop).backgroundColor : "#ffffff";
    context.fillRect(0, 0, 1, 1);
    const video = videoAtPoint(canvas.ownerDocument || document, clientX, clientY);
    if (video) {
      if (video.unavailable || !drawVideoPixel(context, video)) return null;
      const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      return "#" + (visible ? channels : authoredVideoColor(channels, getComputedStyle(canvas).filter)).map(channel => channel.toString(16).padStart(2, "0")).join("");
    }
    if (visible) context.filter = getComputedStyle(canvas).filter;
    context.drawImage(canvas, pixelX, pixelY, 1, 1, 0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return "#" + [...pixel].slice(0, 3).map(channel => channel.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}