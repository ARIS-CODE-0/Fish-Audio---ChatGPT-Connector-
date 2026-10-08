import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { encryptKey, decryptKey } from "../lib/key-crypto.ts";
import { createVoiceService } from "../lib/voice-service.ts";
import { handleMcp } from "../lib/mcp.ts";
import { parseRange } from "../lib/contracts.ts";

const secret = Buffer.alloc(32, 51).toString("base64");
const origin = "https://voice.test";
function fixture({ failSynthesis = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../drizzle/", import.meta.url)).filter(x => x.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  const db = { prepare(sql) {
    const stmt = sqlite.prepare(sql); let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return stmt.get(...args) ?? null; },
      async all() { return { results: stmt.all(...args) }; },
      async run() { const r = stmt.run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    };
  } };
  const objects = new Map();
  const bucket = { async put(key, data) { objects.set(key, data); return { size: data.byteLength }; }, async head(key) { const data = objects.get(key); return data ? { size: data.byteLength } : null; } };
  let syntheses = 0; const requests = [];
  const mockFetch = async (url, init) => {
    requests.push({ url, init });
    if (url.includes("/model")) return Response.json({ total: 1, items: [{ _id: "voice_123456", type: "tts", title: "French Studio", languages: ["fr"], description: "Narration" }] });
    assert.equal(url, "https://api.fish.audio/v1/tts"); syntheses++;
    if (failSynthesis) return Response.json({ message: "Sensitive upstream details" }, { status: 402 });
    return new Response(new Uint8Array([255, 251, 144, 68]), { headers: { "Content-Type": "audio/mpeg" } });
  };
  return { service: createVoiceService({ db, bucket, secret, origin, fetch: mockFetch }), sqlite, objects, requests, syntheses: () => syntheses };
}
const configured = { api_key: "test-api-key-123456789", default_voice: "voice_123456", model: "s2.1-pro-free" };
const requestData = { text: "Bonjour Aris.", title: "Démo", request_id: "request_12345678" };
function rpc(method, params = {}, headers = {}) {
  return new Request(`${origin}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}

test("la clé chiffrée est aléatoire et ne peut pas être déchiffrée pour un autre compte", async () => {
  const a = await encryptKey(configured.api_key, "aris", secret);
  const b = await encryptKey(configured.api_key, "aris", secret);
  assert.notEqual(a, b); assert.ok(!a.includes(configured.api_key));
  assert.equal(await decryptKey(a, "aris", secret), configured.api_key);
  await assert.rejects(decryptKey(a, "other-user", secret));
  await assert.rejects(decryptKey(a, "aris", Buffer.alloc(32, 9).toString("base64")));
});
test("configuration et génération utilisent l’API documentée, sans exposer la clé", async () => {
  const f = fixture(); await f.service.saveSettings("aris", configured);
  const stored = f.sqlite.prepare("SELECT encrypted_key FROM voice_settings WHERE user_id='aris'").get();
  assert.ok(!stored.encrypted_key.includes(configured.api_key));
  const status = await f.service.getStatus("aris"); assert.equal(status.configured, true);
  assert.ok(!JSON.stringify(status).includes(configured.api_key));
  const clip = await f.service.generate("aris", requestData);
  assert.equal(clip.status, "ready"); assert.equal(clip.bytes, 4); assert.equal(f.objects.size, 1);
  const tts = f.requests.find(r => r.url.endsWith("/v1/tts"));
  assert.equal(tts.init.headers.model, "s2.1-pro-free");
  const body = JSON.parse(tts.init.body); assert.equal(body.reference_id, "voice_123456"); assert.equal(body.format, "mp3"); assert.equal(body.prosody.speed, 1);
  assert.equal(clip.audio_url, `${origin}/audio/${clip.id}`);
});
test("les requêtes concurrentes et les relances ne lancent qu’une seule synthèse", async () => {
  const f = fixture(); await f.service.saveSettings("aris", configured);
  const [a, b] = await Promise.all([f.service.generate("aris", requestData), f.service.generate("aris", requestData)]);
  assert.equal(a.id, b.id); assert.equal(f.syntheses(), 1);
  const again = await f.service.generate("aris", requestData); assert.equal(again.id, a.id); assert.equal(f.syntheses(), 1);
  await assert.rejects(f.service.generate("aris", { ...requestData, text: "Autre texte." }), { status: 409 });
});
test("un autre compte ne peut lire ni l’audio ni les réglages du propriétaire", async () => {
  const f = fixture(); await f.service.saveSettings("aris", configured); const clip = await f.service.generate("aris", requestData);
  await assert.rejects(f.service.getVoiceover("other", clip.id), { status: 404 });
  assert.deepEqual((await f.service.listVoiceovers("other")).voiceovers, []);
  assert.equal((await f.service.getStatus("other")).configured, false);
  await assert.rejects(f.service.generate("other", requestData), { status: 409 });
});
test("un audio déjà stocké est récupéré après interruption sans nouvelle synthèse", async () => {
  const f = fixture(); await f.service.saveSettings("aris", configured);
  const clip = await f.service.generate("aris", requestData);
  f.sqlite.prepare("UPDATE voiceovers SET status='generating', object_key=NULL, bytes=NULL WHERE id=?").run(clip.id);
  const recovered = await f.service.generate("aris", requestData);
  assert.equal(recovered.status, "ready"); assert.equal(recovered.bytes, 4); assert.equal(f.syntheses(), 1);
  f.objects.clear(); f.sqlite.prepare("UPDATE voiceovers SET status='generating', created_at='2020-01-01T00:00:00Z' WHERE id=?").run(clip.id);
  assert.equal((await f.service.generate("aris", requestData)).status, "interrupted"); assert.equal(f.syntheses(), 1);
});
test("un refus Fish Audio est conservé et n’entraîne pas de relance automatique", async () => {
  const f = fixture({ failSynthesis: true }); await f.service.saveSettings("aris", configured);
  await assert.rejects(f.service.generate("aris", requestData), /quota/);
  const again = await f.service.generate("aris", requestData);
  assert.equal(again.status, "failed"); assert.equal(f.syntheses(), 1);
  assert.ok(!again.error.includes("Sensitive upstream")); assert.equal(f.objects.size, 0);
});
test("les textes trop longs sont refusés avant toute synthèse", async () => {
  const f = fixture(); await f.service.saveSettings("aris", configured);
  await assert.rejects(f.service.generate("aris", { ...requestData, text: "a".repeat(1501) }));
  assert.equal(f.syntheses(), 0);
});
test("discovery MCP est disponible sans données privées, les appels privés exigent une identité", async () => {
  const f = fixture();
  const discovery = await handleMcp(rpc("tools/list"), origin, () => { throw new Error("Private service must not be touched"); });
  const tools = (await discovery.json()).result.tools;
  assert.equal(tools.length, 5);
  for (const tool of tools) {
    assert.deepEqual(tool.securitySchemes, [{ type: "oauth2", scopes: [] }]);
    assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
  }
  const init = await handleMcp(rpc("initialize", { protocolVersion: "2026-07-28" }), origin, () => f.service);
  assert.equal((await init.json()).result.protocolVersion, "2025-06-18");
  const blocked = await handleMcp(rpc("tools/call", { name: "get_status" }), origin, () => f.service);
  assert.equal(blocked.status, 401);
  const denied = (await blocked.json()).result;
  assert.equal(denied.isError, true);
  assert.match(blocked.headers.get("WWW-Authenticate"), /Bearer.*error="invalid_token"/);
  assert.deepEqual(denied._meta["mcp/www_authenticate"], [blocked.headers.get("WWW-Authenticate")]);
  const accepted = await handleMcp(rpc("tools/call", { name: "get_status" }, { "oai-authenticated-user-id": "aris" }), origin, () => f.service);
  assert.equal((await accepted.json()).result.structuredContent.configured, false);
  const foreign = await handleMcp(rpc("tools/list", {}, { Origin: "https://elsewhere.test" }), origin, () => f.service);
  assert.equal(foreign.status, 403);
});
test("un token fourni directement ne remplace pas l’identité vérifiée par Sites", async () => {
  const denied = await handleMcp(rpc("tools/call", { name: "generate_voiceover", arguments: requestData }, {
    Authorization: "Bearer synthetic-untrusted-token",
  }), origin, () => { throw new Error("Unauthenticated service must not be touched"); });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).result.isError, true);
});
test("les plages audio nécessaires à Safari sont bornées correctement", () => {
  assert.deepEqual(parseRange("bytes=2-8", 10), { start: 2, end: 8, length: 7 });
  assert.deepEqual(parseRange("bytes=-4", 10), { start: 6, end: 9, length: 4 });
  assert.deepEqual(parseRange("bytes=8-999", 10), { start: 8, end: 9, length: 2 });
  assert.throws(() => parseRange("bytes=10-", 10));
  assert.throws(() => parseRange("bytes=0-2,5-8", 10));
});
