import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Use the workerd runtime shipped with our pinned Wrangler dependency. A Node
// fetch mock alone does not enforce the receiver required by Workers fetch.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, createFetchMock } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const origin = "https://voice.test";
const apiKey = "runtime-test-key-123456789";

test("le formulaire vérifie et chiffre la clé dans le véritable moteur Workers", async () => {
  const bundle = await build({
    stdin: {
      contents: 'import { POST } from "./app/api/studio/route.ts"; export default { fetch: POST };',
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      sourcefile: "worker-test.ts",
      loader: "ts",
    },
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
    external: ["cloudflare:workers"],
  });
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  const fish = fetchMock.get("https://api.fish.audio");
  fish.intercept({ path: "/model?page_size=1&self=true", method: "GET", headers: { authorization: `Bearer ${apiKey}` } })
    .reply(200, { total: 0, items: [] });
  fish.intercept({ path: "/model?page_size=1&self=true", method: "GET", headers: { authorization: "Bearer invalid-test-key-1234" } })
    .reply(401, "Upstream details must stay private");
  const mf = new Miniflare({
    modules: true, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"],
    script: bundle.outputFiles[0].text, fetchMock, cf: false,
    bindings: { SITE_ORIGIN: origin, FISH_KEY_ENCRYPTION_SECRET: Buffer.alloc(32, 51).toString("base64") },
    d1Databases: ["DB"], r2Buckets: ["BUCKET"],
  });
  try {
    const db = await mf.getD1Database("DB");
    for (const name of readdirSync(new URL("../drizzle/", import.meta.url)).filter(x => x.endsWith(".sql")).sort()) {
      const sql = readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
      for (const statement of sql.split(";").filter(x => x.trim())) await db.prepare(statement).run();
    }
    const save = key => mf.dispatchFetch(`${origin}/api/studio`, {
      method: "POST", headers: {
        "Content-Type": "application/json", Origin: origin, "oai-authenticated-user-id": "runtime-test-user",
      },
      body: JSON.stringify({ action: "settings", data: { api_key: key, default_voice: "", model: "s2.1-pro-free" } }),
    });
    const accepted = await save(apiKey);
    assert.equal(accepted.status, 200, await accepted.clone().text());
    const status = await accepted.json();
    assert.equal(status.configured, true);
    assert.ok(!JSON.stringify(status).includes(apiKey));
    const before = await db.prepare("SELECT encrypted_key FROM voice_settings WHERE user_id = ?").bind("runtime-test-user").first();
    assert.ok(before.encrypted_key.startsWith("v1."));
    assert.ok(!before.encrypted_key.includes(apiKey));

    const refused = await save("invalid-test-key-1234");
    assert.equal(refused.status, 502);
    const failure = await refused.json();
    assert.match(failure.error, /clé API Fish Audio est invalide/);
    assert.ok(!JSON.stringify(failure).includes("Upstream details"));
    const after = await db.prepare("SELECT encrypted_key FROM voice_settings WHERE user_id = ?").bind("runtime-test-user").first();
    assert.equal(after.encrypted_key, before.encrypted_key);
    fetchMock.assertNoPendingInterceptors();
  } finally { await mf.dispose(); }
});
