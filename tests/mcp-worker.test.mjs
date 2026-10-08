import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const wr = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, createFetchMock } = wr("miniflare");
const { build } = wr("esbuild");

for (const endpoint of ["/mcp", "/api/diagnostic/mcp"]) test(`${endpoint} : les cinq outils fonctionnent dans Workers jusqu’au MP3 avec des logs corrélés`, async () => {
  const origin = "https://voice.test";
  const key = "synthetic-mcp-test-key";
  const bundle = await build({
    stdin: { contents: 'import { POST as mcp } from "./app/mcp/route.ts"; import { POST as diagnostic } from "./app/api/diagnostic/mcp/route.ts"; import { POST as studio } from "./app/api/studio/route.ts"; export default {fetch(r){const p=new URL(r.url).pathname; return p === "/mcp" ? mcp(r) : p === "/api/diagnostic/mcp" ? diagnostic(r) : studio(r)}};', resolveDir: root, sourcefile: "mcp-test.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:workers"],
  });
  const mock = createFetchMock(); mock.disableNetConnect();
  const fish = mock.get("https://api.fish.audio");
  let ttsRequest;
  fish.intercept({ path: "/model?page_size=1&self=true", method: "GET", headers: { authorization: `Bearer ${key}` } }).reply(200, { items: [], total: 0 });
  fish.intercept({ path: "/model?page_size=12&page_number=1&self=false&language=fr", method: "GET", headers: { authorization: `Bearer ${key}` } }).reply(200, { items: [{ _id: "voice_test123", type: "tts", title: "Test FR", languages: ["fr"] }], total: 1 });
  // Miniflare forwards POST bodies as ReadableStream. Match the route, then
  // inspect the actual stream rather than comparing it to a string matcher.
  fish.intercept({ path: "/v1/tts", method: "POST" }).reply(options => {
    ttsRequest = options;
    return { statusCode: 200, data: Buffer.from([255, 251, 144, 68]), responseOptions: { headers: { "content-type": "audio/mpeg" } } };
  });
  const logs = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], script: bundle.outputFiles[0].text, fetchMock: mock, cf: false,
    handleRuntimeStdio(stdout, stderr) { for (const stream of [stdout, stderr]) stream.on("data", chunk => logs.push(chunk.toString())); },
    bindings: { SITE_ORIGIN: origin, FISH_KEY_ENCRYPTION_SECRET: Buffer.alloc(32, 51).toString("base64") }, d1Databases: ["DB"], r2Buckets: ["BUCKET"] });
  try {
    const db = await mf.getD1Database("DB");
    for (const name of readdirSync(`${root}/drizzle`).filter(n => n.endsWith(".sql")).sort()) {
      for (const sql of readFileSync(`${root}/drizzle/${name}`, "utf8").split(";").filter(s => s.trim())) await db.prepare(sql).run();
    }
    let id = 1;
    const send = async (method, params = {}, signed = true) => {
      const r = await mf.dispatchFetch(`${origin}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(signed ? { "oai-authenticated-user-id": "synthetic-test-user" } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }) });
      assert.equal(r.status, 200, await r.clone().text());
      const trace = r.headers.get("X-Fish-Audio-Trace-Id"); assert.match(trace, /^[a-f0-9-]{36}$/);
      return { result: (await r.json()).result, trace };
    };
    const init = await send("initialize", { protocolVersion: "2025-06-18" }, false); assert.ok(init.result.capabilities.tools);
    const tools = await send("tools/list", {}, false);
    assert.deepEqual(tools.result.tools.map(t => t.name), ["get_status", "list_voices", "generate_voiceover", "list_voiceovers", "get_voiceover"]);
    const notification = await mf.dispatchFetch(`${origin}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    assert.equal(notification.status, 202);
    const malformed = await mf.dispatchFetch(`${origin}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "initialize", params: null }) });
    assert.equal(malformed.status, 400); assert.equal((await malformed.json()).error.code, -32602);
    if (endpoint !== "/mcp") {
      for (const badOrigin of [null, "https://other.test"]) {
        const refused = await mf.dispatchFetch(`${origin}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", ...(badOrigin ? { Origin: badOrigin } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 100, method: "initialize" }) });
        assert.equal(refused.status, 403);
      }
      const anonymous = await mf.dispatchFetch(`${origin}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ jsonrpc: "2.0", id: 101, method: "tools/call", params: { name: "get_status", arguments: {} } }) });
      assert.equal(anonymous.status, 401); assert.equal((await anonymous.json()).result.isError, true);
    }
    const saved = await mf.dispatchFetch(`${origin}/api/studio`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "oai-authenticated-user-id": "synthetic-test-user" }, body: JSON.stringify({ action: "settings", data: { api_key: key, default_voice: "voice_test123", model: "s2.1-pro-free" } }) });
    assert.equal(saved.status, 200, await saved.clone().text());
    const call = async (name, args = {}) => {
      const r = await send("tools/call", { name, arguments: args });
      assert.equal(r.result.isError, false, JSON.stringify(r.result)); assert.ok(!JSON.stringify(r.result).includes(key));
      return { data: r.result.structuredContent, trace: r.trace };
    };
    assert.equal((await call("get_status")).data.configured, true);
    assert.equal((await call("list_voices")).data.voices[0].id, "voice_test123");
    const clip = await call("generate_voiceover", { text: "Test MCP.", request_id: "synthetic_request_123" });
    assert.equal(clip.data.status, "ready"); assert.equal(clip.data.bytes, 4);
    assert.equal((await call("list_voiceovers")).data.voiceovers[0].id, clip.data.id);
    assert.equal((await call("get_voiceover", { id: clip.data.id })).data.id, clip.data.id);
    assert.equal(ttsRequest.headers.authorization, `Bearer ${key}`); assert.equal(ttsRequest.headers.model, "s2.1-pro-free");
    assert.deepEqual(JSON.parse(await new Response(ttsRequest.body).text()), { text: "Test MCP.", reference_id: "voice_test123", format: "mp3", mp3_bitrate: 192, latency: "normal", prosody: { speed: 1, volume: 0, normalize_loudness: true } });
    const serialized = logs.join("");
    assert.ok(serialized.includes(clip.trace)); assert.ok(serialized.includes("fish.response"));
    assert.ok(!serialized.includes(key)); assert.ok(!serialized.includes("Test MCP.")); assert.ok(!serialized.includes("synthetic-test-user"));
    // A real client disconnect must not abandon the single claimed synthesis.
    fish.intercept({ path: "/v1/tts", method: "POST" }).reply(200, Buffer.from([255, 251, 144, 68]), { headers: { "content-type": "audio/mpeg" } }).delay(500);
    const controller = new AbortController();
    const abandoned = mf.dispatchFetch(`${origin}${endpoint}`, { method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", Origin: origin, "oai-authenticated-user-id": "synthetic-test-user" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 102, method: "tools/call", params: { name: "generate_voiceover", arguments: { text: "Test après déconnexion.", request_id: "disconnect_request_123" } } }) });
    const handled = abandoned.catch(error => error);
    let row;
    for (let n = 0; n < 100; n++) {
      row = await db.prepare("SELECT status FROM voiceovers WHERE request_id=?").bind("disconnect_request_123").first();
      if (row) break; await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(row?.status, "generating"); controller.abort();
    assert.equal((await handled).name, "AbortError");
    for (let n = 0; n < 200; n++) {
      row = await db.prepare("SELECT status, bytes FROM voiceovers WHERE request_id=?").bind("disconnect_request_123").first();
      if (row?.status === "ready") break; await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(row?.status, "ready"); assert.equal(row.bytes, 4);
    mock.assertNoPendingInterceptors();
  } finally { await mf.dispose(); }
});
