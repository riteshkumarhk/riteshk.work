export const ACCESS_MS = 5 * 60 * 1000;
export const IDLE_MS = 30 * 60 * 1000;
export const SESSION_MS = 12 * 60 * 60 * 1000;
export const REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;
const ROTATE_MS = 5 * 60 * 1000;
const GRACE_MS = 10000;

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function secret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}

function split(value) {
  const match = /^s2\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value || "");
  return match ? { id: match[1], secret: match[2] } : null;
}

function credential(id, value) { return "s2." + id + "." + value; }

export class AdminSessions {
  constructor(context) { this.context = context; this.storage = context.storage; }

  async fetch(request) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const input = await request.json();
    const action = new URL(request.url).pathname.slice(1);
    return this.context.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const records = await this.storage.get("sessions") || [];
      const sessions = records.filter(record => record.exp > now);
      const save = async () => {
        await this.storage.put("sessions", sessions);
        if (sessions.length) await this.storage.setAlarm(Math.min(...sessions.map(record => record.exp)));
        else await this.storage.deleteAlarm();
      };
      const response = (body, status = 200) => Response.json(body, { status });
      const access = async record => {
        const value = secret(), exp = Math.min(now + ACCESS_MS, record.exp);
        record.access = record.access.filter(entry => entry.exp > now).slice(-63);
        record.access.push({ hash: await digest(value), exp });
        return { token: credential(record.id, value), exp, sessionId: record.id, sessionExp: record.exp, remembered: record.remembered, verifiedUntil: record.fresh ? record.fresh + ACCESS_MS : 0, idleAt: record.active + IDLE_MS };
      };
      if (action === "issue") {
        const id = crypto.randomUUID().replaceAll("-", ""), refresh = secret(), revoke = secret();
        const record = { id, created: now, active: now, fresh: input.verified === true ? now : 0, exp: now + (input.remember ? REMEMBER_MS : SESSION_MS), remembered: input.remember === true, label: String(input.label || "Browser session").slice(0, 100), refresh: await digest(refresh), rotated: now, used: [], revoke: await digest(revoke), access: [] };
        if (sessions.length >= 50) {
          sessions.sort((first, second) => first.active - second.active);
          sessions.splice(0, sessions.length - 49);
        }
        sessions.push(record);
        const result = await access(record);
        await save();
        return response({ ...result, refresh: record.remembered ? credential(id, refresh) : "", revoke: credential(id, revoke) });
      }
      const parsed = split(input.token);
      const record = parsed && sessions.find(entry => entry.id === parsed.id);
      if (!record) return response({ error: "Session expired. Sign in again." }, 401);
      const hash = await digest(parsed.secret);
      if (action === "forget") {
        if (hash !== record.revoke && hash !== record.refresh && !record.used.some(entry => entry.hash === hash)) return response({ error: "Invalid sign-out request." }, 401);
        sessions.splice(sessions.indexOf(record), 1);
        await save();
        return response({ ok: true });
      }
      if (action === "restore") {
        if (!record.remembered || !record.enrolled) return response({ error: "Sign in again." }, 401);
        const previous = record.used.find(entry => entry.hash === hash);
        if (hash !== record.refresh && !previous) return response({ error: "Sign in again." }, 401);
        if (previous && now - previous.at > GRACE_MS) {
          sessions.splice(sessions.indexOf(record), 1);
          await save();
          return response({ error: "Remembered session was reused and has been revoked. Sign in again." }, 401);
        }
        if (now - record.active >= IDLE_MS || record.locked) return response({ error: "Session locked. Verify with your passkey.", locked: true }, 423);
        let refresh;
        if (!previous && now - record.rotated >= ROTATE_MS) {
          const value = secret();
          record.used.push({ hash: record.refresh, at: now });
          record.refresh = await digest(value);
          record.rotated = now;
          refresh = credential(record.id, value);
        }
        const result = await access(record);
        await save();
        return response({ ...result, refresh });
      }
      if (!record.access.some(entry => entry.hash === hash && entry.exp > now)) return response({ error: "Session expired. Sign in again." }, 401);
      if (action === "logout") {
        sessions.splice(sessions.indexOf(record), 1);
        await save();
        return response({ ok: true });
      }
      if (now - record.active >= IDLE_MS || record.locked) return response({ error: "Session locked. Verify with your passkey.", locked: true }, 423);
      if (action === "remember") {
        if (!record.remembered || record.enrolled || now - record.created > 60000) return response({ error: "Start sign-in again to remember this browser." }, 403);
        const value = secret();
        record.refresh = await digest(value);
        record.enrolled = true;
        await save();
        return response({ ok: true, refresh: credential(record.id, value), sessionExp: record.exp });
      }
      if (action === "verify") return response({ ok: true, id: record.id, fresh: record.fresh });
      if (action === "verified") {
        record.fresh = now;
        await save();
        return response({ ok: true, verifiedUntil: now + ACCESS_MS });
      }
      if (action === "activity") {
        record.active = now;
        await save();
        return response({ ok: true, idleAt: now + IDLE_MS });
      }
      if (action === "lock") {
        record.locked = true;
        await save();
        return response({ ok: true });
      }
      if (action === "renew") {
        const result = await access(record);
        await save();
        return response(result);
      }
      if (action === "list" || action === "revoke") {
        if (now - record.fresh > ACCESS_MS) return response({ error: "Verify with your passkey first." }, 403);
        if (action === "list") return response({ sessions: sessions.map(entry => ({ id: entry.id, label: entry.label, created: entry.created, active: entry.active, exp: entry.exp, remembered: entry.remembered, current: entry.id === record.id })) });
        if (input.all === true) sessions.splice(0);
        else {
          const index = sessions.findIndex(entry => entry.id === input.id);
          if (index >= 0) sessions.splice(index, 1);
        }
        await save();
        return response({ ok: true });
      }
      return response({ error: "Unknown session operation." }, 404);
    });
  }

  async alarm() {
    const sessions = (await this.storage.get("sessions") || []).filter(record => record.exp > Date.now());
    await this.storage.put("sessions", sessions);
    if (sessions.length) await this.storage.setAlarm(Math.min(...sessions.map(record => record.exp)));
  }
}

export async function adminSessionOperation(env, action, input = {}) {
  if (!env.ADMIN_SESSIONS) throw Object.assign(new Error("Session service unavailable."), { status: 503 });
  try {
    const object = env.ADMIN_SESSIONS.get(env.ADMIN_SESSIONS.idFromName("owner"));
    const response = await object.fetch("https://session.internal/" + action, { method: "POST", body: JSON.stringify(input) });
    return { status: response.status, body: await response.json() };
  } catch (error) { throw Object.assign(new Error("Session service unavailable."), { status: 503 }); }
}