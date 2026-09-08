import { useEffect, useRef, useState } from "react";
import { useHandleLibrary } from "@excalidraw/excalidraw";
import { ADMIN_WORKER, ADMIN_SESSION_KEY, adminSession } from "./admin-core.js";
import { createLibrarySync, applyLibrarySnapshot } from "./slide-library-sync.mjs";

async function cloudRequest(token, body) {
  const response = await fetch(ADMIN_WORKER + "/admin/slide-library", {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(20000)
  });
  if (response.status === 409) return { conflict: true };
  if (!response.ok) { const body = await response.json().catch(() => null); const error = new Error(body?.error || "Sync failed; retry"); error.status = response.status; throw error; }
  return response.json();
}

export function useSlideLibrary(api, interactive) {
  const [status, setStatus] = useState("Library: loading");
  const [readyApi, setReadyApi] = useState(null);
  const [importApi, setImportApi] = useState(null);
  const controller = useRef(null), nativeItems = useRef([]);
  useEffect(() => { if (readyApi && interactive) setImportApi(readyApi); }, [readyApi, interactive]);
  useHandleLibrary({
    excalidrawAPI: importApi,
    validateLibraryUrl: value => {
      const url = new URL(value);
      return url.origin === "https://libraries.excalidraw.com" && url.pathname.startsWith("/libraries/") && url.pathname.endsWith(".excalidrawlib");
    }
  });
  useEffect(() => {
    if (!api) return;
    let disposed = false;
    const apply = async items => {
      if (disposed) return;
      await applyLibrarySnapshot(api, structuredClone(nativeItems.current), items);
    };
    const sync = createLibrarySync({ session: adminSession, request: cloudRequest, onItems: apply, onStatus: value => { if (!disposed) setStatus(value); } });
    controller.current = sync;
    sync.ready.then(async items => {
      if (disposed) return;
      await apply(items);
      if (disposed) return;
      setReadyApi(api);
      await sync.sync();
    }).catch(() => setStatus("Library: local storage unavailable"));
    const refresh = () => { if (document.visibilityState === "visible") sync.sync(); };
    const storage = event => { if (event.key === ADMIN_SESSION_KEY) refresh(); };
    const leave = event => {
      if (controller.current?.saving) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("beforeunload", leave);
    return () => {
      disposed = true; sync.stop(); controller.current = null;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("beforeunload", leave);
    };
  }, [api]);
  return {
    status,
    onChange: items => { nativeItems.current = items; if (readyApi) return controller.current?.change(items); },
    retry: () => {
      if (!adminSession()) window.open("/studio/", "_blank", "noopener");
      else controller.current?.sync();
    }
  };
}