const GEMINI = "https://generativelanguage.googleapis.com";
const MAX_FILE_BYTES = 2_000_000_000;

export function whiteboardFocus(current, available, started = "") {
  if (started === "screen" && available.screen) return "screen";
  if (available[current]) return current;
  return available.screen ? "screen" : available.camera ? "camera" : "";
}

export function isWhiteboardVideoProvider(config) {
  return config?.provider === "gemini" && !config.proxied && !!config.key &&
    config.base?.replace(/\/+$/, "") === GEMINI + "/v1beta";
}

export async function startWhiteboardRecording({ video, source, signal, onError }) {
  if (!globalThis.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error("Audio/video recording is unavailable in this browser.");
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }, video: false });
  let stream, interval, recorder, timeout, reader, captureTrack, currentTrack, generation = 0;
  const releaseReader = () => {
    generation++;
    reader?.cancel().catch(failure => console.warn("Whiteboard capture cleanup failed", failure));
    reader = null; captureTrack?.stop(); captureTrack = null;
  };
  const cleanup = () => {
    clearInterval(interval); clearTimeout(timeout);
    releaseReader();
    mic.getTracks().forEach(track => track.stop());
    stream?.getTracks().forEach(track => track.stop());
    signal?.removeEventListener("abort", stop);
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
  let finish, fail, stopped = false, error = "", endedAt = null;
  const finished = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  // The caller attaches its completion handler after microphone permission resolves.
  finished.catch(() => {});
  function stop() {
    if (stopped) return finished;
    stopped = true; endedAt = performance.now();
    try {
      if (recorder?.state !== "inactive") recorder.stop();
      timeout = setTimeout(() => { cleanup(); fail(new Error("Recording did not finish. Download any completed recordings before leaving.")); }, 15000);
    } catch (failure) { cleanup(); fail(failure); }
    return finished;
  }
  function captureFailed(message) { if (stopped) return; error = message; onError(error); stop(); }
  function visibilityChanged() {
    if (document.hidden) captureFailed("This browser cannot keep recording in the background. Recording stopped and is incomplete; keep Studio visible or use a supported Chromium browser.");
  }
  try {
    signal?.throwIfAborted();
    if (!mic.getAudioTracks().some(track => track.readyState === "live")) throw new Error("A working microphone is required to record for AI review.");
    const canvas = document.createElement("canvas"); canvas.width = 1920; canvas.height = 1080;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The recording canvas could not start.");
    const started = performance.now(), timeline = [], chunks = [];
    let bytes = 0;
    function draw(frame) {
      const current = frame || video(), selected = source();
      const videoWidth = frame ? frame.displayWidth : current?.videoWidth, videoHeight = frame ? frame.displayHeight : current?.videoHeight;
      context.fillStyle = "#000"; context.fillRect(0, 0, canvas.width, canvas.height);
      if (videoWidth && (frame || current.readyState >= 2)) {
        const scale = Math.min(canvas.width / videoWidth, canvas.height / videoHeight);
        const width = videoWidth * scale, height = videoHeight * scale;
        context.drawImage(current, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      }
      if (timeline.at(-1)?.source !== selected) timeline.push({ source: selected || "none", seconds: (performance.now() - started) / 1000 });
    }
    draw();
    const frameDriven = typeof globalThis.MediaStreamTrackProcessor === "function";
    stream = canvas.captureStream(frameDriven ? 0 : 15);
    const outputTrack = stream.getVideoTracks()[0];
    async function pump(input, epoch) {
      let nextFrameAt = 0;
      try {
        while (!stopped && epoch === generation) {
          const {value:frame,done} = await input.read();
          if (done) break;
          try {
            if (stopped || epoch !== generation) break;
            const now = performance.now();
            if (now < nextFrameAt) continue;
            nextFrameAt = Math.max(nextFrameAt + 1000 / 15, now);
            draw(frame); outputTrack.requestFrame();
          } finally { frame.close(); }
        }
      } catch {
        if (!stopped && epoch === generation) captureFailed("The focused video could not be recorded. Recording has stopped and is incomplete.");
      } finally { input.releaseLock(); }
    }
    function syncSource() {
      if (stopped || !frameDriven) return;
      const track = video()?.srcObject?.getVideoTracks()[0];
      if (track === currentTrack) return;
      releaseReader(); currentTrack = track;
      if (!track || track.readyState !== "live") return;
      try {
        captureTrack = track.clone();
        reader = new MediaStreamTrackProcessor({track:captureTrack,maxBufferSize:1}).readable.getReader();
        pump(reader,generation);
      } catch { captureFailed("The focused video could not be recorded. Recording has stopped and is incomplete."); }
    }
    mic.getAudioTracks().forEach(track => {
      stream.addTrack(track);
      track.addEventListener("ended", () => {
        if (stopped) return;
        error = "The recording microphone disconnected. This recording is incomplete.";
        onError(error); stop();
      });
    });
    const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("This browser cannot record a supported audio/video format.");
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      chunks.push(event.data); bytes += event.data.size;
      if (bytes >= MAX_FILE_BYTES && !stopped) {
        error = "The recording reached the provider's 2 GB portable upload limit. It has stopped; download it before leaving.";
        onError(error); stop();
      }
    };
    recorder.onerror = () => { error = "Audio/video recording failed. The captured portion may be incomplete."; onError(error); stop(); };
    recorder.onstop = () => {
      stopped = true;
      const duration = ((endedAt ?? performance.now()) - started) / 1000;
      cleanup();
      const blob = new Blob(chunks, { type: recorder.mimeType });
      if (!blob.size) { fail(new Error("No recording data was captured. Keep your feed active and try again.")); return; }
      finish({ blob, duration, timeline, error, type: blob.type, audio: true });
    };
    recorder.start(1000);
    if (frameDriven) syncSource();
    else {
      document.addEventListener("visibilitychange", visibilityChanged);
      interval = setInterval(() => {
        try { draw(); }
        catch { captureFailed("The focused video could not be recorded. Recording has stopped and is incomplete."); }
      }, 1000 / 15);
      visibilityChanged();
    }
    signal?.addEventListener("abort", stop, { once: true });
    return { stop, finished, recorder, syncSource };
  } catch (failure) { cleanup(); throw failure; }
}

function fileName(value) {
  if (!/^files\/[a-zA-Z0-9_-]+$/.test(value || "")) throw new Error("The provider returned an invalid file reference.");
  return value;
}

async function responseJson(response, label) {
  if (!response.ok) throw new Error(label + " failed (HTTP " + response.status + "). Retry without leaving the session.");
  try { return await response.json(); } catch { throw new Error(label + " returned an invalid response."); }
}

const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
  signal?.throwIfAborted();
  const aborted = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener("abort", aborted); resolve(); }, milliseconds);
  signal?.addEventListener("abort", aborted, { once: true });
});

export async function withWhiteboardVideoFiles(config, recordings, { signal, progress, warning, invoke, fetcher = fetch, poll = wait }) {
  if (!isWhiteboardVideoProvider(config)) throw new Error("Full recording review requires a directly connected Gemini service. Proxy connections and image-only providers are not supported for video uploads.");
  if (!recordings.length || recordings.some(item => !item.audio || !item.blob?.size || item.blob.size > MAX_FILE_BYTES || item.error)) throw new Error("A complete audio/video recording under 2 GB per segment is required. Incomplete recordings remain downloadable.");
  const uploaded = [], headers = { "x-goog-api-key": config.key };
  const deadline = AbortSignal.timeout(15 * 60 * 1000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    for (const [index, recording] of recordings.entries()) {
      requestSignal.throwIfAborted();
      progress("Uploading recording " + (index + 1) + "/" + recordings.length + " to Gemini...");
      // A caller-generated file name allows cleanup even if the final upload response is lost.
      const name = "files/wb-" + crypto.randomUUID();
      const mimeType = recording.type.split(";")[0];
      const start = await fetcher(GEMINI + "/upload/v1beta/files", {
        method: "POST", redirect: "error", headers: { ...headers, "Content-Type": "application/json",
          "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(recording.blob.size), "X-Goog-Upload-Header-Content-Type": mimeType },
        body: JSON.stringify({ file: { name, display_name: "Whiteboard recording " + (index + 1) } }), signal: requestSignal
      });
      if (!start.ok) throw new Error("Video upload could not start (HTTP " + start.status + "). Your local recording is retained.");
      const url = start.headers.get("x-goog-upload-url");
      if (!url || new URL(url).origin !== GEMINI) throw new Error("The provider did not expose a trusted browser upload URL. Your local recording is retained.");
      uploaded.push(name);
      let file = (await responseJson(await fetcher(url, {
        method: "POST", redirect: "error", headers: { ...headers, "Content-Type": mimeType, "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
        body: recording.blob, signal: requestSignal
      }), "Video upload")).file;
      if (fileName(file?.name) !== name) throw new Error("The provider returned an unexpected recording identity.");
      while (file.state === "PROCESSING") {
        progress("Gemini is processing recording " + (index + 1) + "/" + recordings.length + "...");
        await poll(2000, requestSignal);
        file = await responseJson(await fetcher(GEMINI + "/v1beta/" + name, { headers, redirect: "error", signal: requestSignal }), "Video processing");
      }
      if (file.state !== "ACTIVE" || file.name !== name || file.uri !== GEMINI + "/v1beta/" + name) throw new Error("Gemini could not process the recording. Your local recording is retained.");
    }
    return await invoke(uploaded.map((name, index) => ({
      fileData: { fileUri: GEMINI + "/v1beta/" + name, mimeType: recordings[index].type.split(";")[0] }
    })), requestSignal);
  } finally {
    for (const name of uploaded) {
      try {
        const response = await fetcher(GEMINI + "/v1beta/" + fileName(name), { method: "DELETE", headers, redirect: "error", keepalive: true, signal: AbortSignal.timeout(15000) });
        if (!response.ok && response.status !== 404) throw new Error("HTTP " + response.status);
      } catch {
        warning("Gemini file cleanup could not be confirmed for " + name + ". The provider normally expires uploaded files after 48 hours; verify deletion in your Gemini project.");
      }
    }
  }
}

export function whiteboardRecordingEvidence(value, recordings) {
  if (!Array.isArray(value)) throw new Error("The recording review did not include timestamped evidence. Retry the review.");
  return value.filter(item => {
    const recording = recordings.find(entry => entry.id === item?.recordingId);
    return recording && typeof item.id === "string" && /^recording-evidence-[1-9]\d*$/.test(item.id) &&
      Number.isFinite(item.seconds) && item.seconds >= 0 && item.seconds <= recording.duration &&
      typeof item.detail === "string" && item.detail.trim() && ["readable", "audible", "unreadable", "uncertain"].includes(item.status);
  }).filter((item, index, items) => items.findIndex(other => other.id === item.id) === index)
    .map(item => ({ id: item.id, recordingId: item.recordingId, seconds: item.seconds, detail: item.detail.slice(0, 2000), status: item.status }));
}
