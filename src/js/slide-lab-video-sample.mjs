export function videoSourcePoint(width, height, boxWidth, boxHeight, x, y, fit = "contain", position = "50% 50%") {
  if (![width, height, boxWidth, boxHeight].every(value => value > 0) || x < 0 || y < 0 || x >= boxWidth || y >= boxHeight) return null;
  const contain = Math.min(boxWidth / width, boxHeight / height);
  const scale = fit === "cover" ? Math.max(boxWidth / width, boxHeight / height) : fit === "none" ? 1 : fit === "scale-down" ? Math.min(1, contain) : contain;
  const drawnWidth = fit === "fill" ? boxWidth : width * scale;
  const drawnHeight = fit === "fill" ? boxHeight : height * scale;
  const parts = position.split(/\s+/);
  const offset = (value, space) => value?.endsWith("%") ? parseFloat(value) / 100 * space : value === "left" || value === "top" ? 0 : value === "right" || value === "bottom" ? space : value === "center" || !value ? space / 2 : parseFloat(value) || 0;
  const sourceX = (x - offset(parts[0], boxWidth - drawnWidth)) / drawnWidth * width;
  const sourceY = (y - offset(parts[1], boxHeight - drawnHeight)) / drawnHeight * height;
  return sourceX >= 0 && sourceY >= 0 && sourceX < width && sourceY < height ? { x: Math.floor(sourceX), y: Math.floor(sourceY) } : null;
}

export function videoAtPoint(document, clientX, clientY, depth = 0) {
  if (depth > 4 || !document.elementsFromPoint) return null;
  const renderedEmbeds = [...(document.querySelectorAll?.("video.lab-embed, iframe.lab-embed") || [])].reverse().filter(element => {
    const rect = element.getBoundingClientRect();
    const style = document.defaultView.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && clientX >= rect.left && clientY >= rect.top && clientX < rect.right && clientY < rect.bottom;
  });
  for (const element of [...renderedEmbeds, ...document.elementsFromPoint(clientX, clientY)]) {
    if (element.tagName === "VIDEO") return { video: element, clientX, clientY };
    if (element.tagName === "IFRAME" && element.classList.contains("lab-embed")) {
      try {
        const child = element.contentDocument;
        if (!child) return { unavailable: true };
        const rect = element.getBoundingClientRect();
        const scaleX = element.offsetWidth / rect.width, scaleY = element.offsetHeight / rect.height;
        return videoAtPoint(child, (clientX - rect.left) * scaleX - element.clientLeft, (clientY - rect.top) * scaleY - element.clientTop, depth + 1);
      } catch { return { unavailable: true }; }
    }
  }
  return null;
}

export function drawVideoPixel(context, hit) {
  const { video, clientX, clientY } = hit;
  if (video.readyState < 2) return false;
  const rect = video.getBoundingClientRect();
  const style = video.ownerDocument.defaultView.getComputedStyle(video);
  const point = videoSourcePoint(video.videoWidth, video.videoHeight, video.clientWidth, video.clientHeight,
    (clientX - rect.left) * video.offsetWidth / rect.width - video.clientLeft,
    (clientY - rect.top) * video.offsetHeight / rect.height - video.clientTop, style.objectFit, style.objectPosition);
  if (!point) return false;
  context.drawImage(video, point.x, point.y, 1, 1, 0, 0, 1, 1);
  return true;
}

export function authoredVideoColor(channels, filter) {
  if (filter !== "invert(0.93) hue-rotate(180deg)") return channels;
  const inverted = channels.map(channel => (channel / 255 - 0.93) / -0.86);
  const luminance = inverted[0] * 0.213 + inverted[1] * 0.715 + inverted[2] * 0.072;
  return inverted.map(channel => Math.max(0, Math.min(255, Math.round((2 * luminance - channel) * 255))));
}