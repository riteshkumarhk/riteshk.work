export class PasskeyChallenges {
  constructor(context) { this.storage = context.storage; }

  async fetch(request) {
    const action = new URL(request.url).pathname;
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const input = await request.json();
    if (action === "/issue") {
      if (!["auth", "reg"].includes(input.type)) return new Response(null, { status: 400 });
      const record = { type: input.type, purpose: ["publish", "release-checks"].includes(input.purpose) ? input.purpose : "login", exp: Date.now() + 300000 };
      const issued = await this.storage.transaction(async transaction => {
        if (await transaction.get("challenge")) return false;
        await transaction.put("challenge", record);
        return true;
      });
      if (issued) await this.storage.setAlarm(record.exp);
      return issued ? Response.json(record) : new Response(null, { status: 409 });
    }
    if (action !== "/read" && action !== "/consume") return new Response(null, { status: 404 });
    const record = await this.storage.transaction(async transaction => {
      const stored = await transaction.get("challenge");
      if (!stored || stored.type !== input.type || stored.exp <= Date.now() || stored.consumed) return null;
      if (action === "/consume") await transaction.put("challenge", { ...stored, consumed: true });
      return stored;
    });
    return record ? Response.json(record) : new Response(null, { status: 409 });
  }

  async alarm() { await this.storage.deleteAll(); }
}

export async function passkeyChallenge(env, action, challenge, record) {
  if (!env.PASSKEY_CHALLENGES) throw Object.assign(new Error("Passkey challenge service unavailable"), { status: 503 });
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge || "")) return null;
  try {
    const object = env.PASSKEY_CHALLENGES.get(env.PASSKEY_CHALLENGES.idFromName(challenge));
    const response = await object.fetch("https://passkey.internal/" + action, { method: "POST", body: JSON.stringify(record) });
    if (response.status === 409) return null;
    if (!response.ok) throw new Error("Challenge storage request failed");
    return await response.json();
  } catch (error) { throw Object.assign(new Error("Passkey challenge service unavailable"), { status: 503 }); }
}