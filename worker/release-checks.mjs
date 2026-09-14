const definitionsKey = "validation-checks.json";
const resultsKey = "check-results.json";
const statuses = new Set(["pending", "passed", "issue", "blocked", "not-applicable"]);
const failure = (status, message) => Object.assign(new Error(message), { status });

async function fingerprint(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function snapshot(bucket) {
  const definitionObject = await bucket.get(definitionsKey);
  if (!definitionObject) throw failure(503, "The private checklist has not been uploaded.");
  const document = await definitionObject.json();
  if (document?.schemaVersion !== 1 || !Array.isArray(document.releases)) throw new Error("Invalid checklist");
  const identifiers = new Set();
  for (const release of document.releases) {
    if (!Array.isArray(release.checks)) throw new Error("Invalid release");
    for (const check of release.checks) {
      if (!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(check.id) || identifiers.has(check.id) || !Array.isArray(check.steps) || !check.steps.length || typeof check.expected !== "string") throw new Error("Invalid case");
      identifiers.add(check.id);
      check.definitionVersion = await fingerprint({ release: release.id, version: release.version, check });
    }
  }
  const resultObject = await bucket.get(resultsKey);
  if (!resultObject) throw failure(503, "The private results store has not been initialized.");
  const results = await resultObject.json();
  if (results?.schemaVersion !== 1 || !Number.isSafeInteger(results.revision) || results.revision < 0 || !results.checks || typeof results.checks !== "object" || Array.isArray(results.checks)) throw new Error("Invalid saved results");
  for (const record of Object.values(results.checks)) {
    if (!statuses.has(record?.status) || typeof record.notes !== "string" || !Array.isArray(record.history)) throw new Error("Invalid saved history");
  }
  return { data: { document, results }, etag: resultObject.etag };
}

export async function releaseChecksRoute(request, bucket, headers = {}) {
  const respond = (status, data) => Response.json(data, { status, headers: { ...headers, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  try {
    if (!bucket) throw failure(503, "Checklist storage is not configured.");
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/admin/release-checks") return respond(200, (await snapshot(bucket)).data);
    const match = /^\/admin\/release-checks\/results\/([A-Z0-9][A-Z0-9-]{2,39})$/.exec(path);
    if (!match || request.method !== "PUT") throw failure(404, "Not found.");
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw failure(415, "A JSON result is required.");
    const reader = request.body?.getReader();
    if (!reader) throw failure(400, "The result is empty.");
    const chunks = []; let length = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 16384) { await reader.cancel(); throw failure(413, "The result is too large."); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let input;
    try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw failure(400, "The result is not valid JSON."); }
    if (!input || !statuses.has(input.status) || typeof input.notes !== "string" || input.notes.length > 4000 || !Number.isSafeInteger(input.revision)) throw failure(400, "Choose a valid result and notes of at most 4,000 characters.");
    const current = await snapshot(bucket);
    const check = current.data.document.releases.flatMap(release => release.checks).find(item => item.id === match[1]);
    if (!check) throw failure(404, "This case does not exist.");
    if (input.revision !== current.data.results.revision || input.definitionVersion !== check.definitionVersion) return respond(409, { error: "The checklist changed. Your result has not overwritten the saved result.", current: current.data });
    const previous = current.data.results.checks[check.id];
    const entry = { status: input.status, notes: input.notes.trim(), at: new Date().toISOString(), definitionVersion: check.definitionVersion };
    if (previous?.status === entry.status && previous.notes === entry.notes && previous.definitionVersion === entry.definitionVersion) return respond(200, current.data);
    current.data.results.checks[check.id] = { ...entry, history: [...(previous?.history || []), entry] };
    current.data.results.revision++;
    const write = await bucket.put(resultsKey, JSON.stringify(current.data.results), { onlyIf: { etagMatches: current.etag }, httpMetadata: { contentType: "application/json" } });
    if (!write) return respond(409, { error: "Another device saved first. Review the saved result.", current: (await snapshot(bucket)).data });
    return respond(200, current.data);
  } catch (error) {
    return respond(error.status || 503, { error: error.status ? error.message : "The private checklist could not be read or saved. No save is confirmed." });
  }
}