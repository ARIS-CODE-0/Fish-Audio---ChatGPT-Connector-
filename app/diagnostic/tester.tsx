"use client";
import { useRef, useState } from "react";
type Data = Record<string, unknown>;
type Entry = { time: string; endpoint: string; method: string; tool?: string; request: Data; http_status?: number; trace_id?: string | null; elapsed_ms: number; response?: unknown; error?: string };
const browserEndpoint = "/api/diagnostic/mcp";
const text = "Salut Aris. Ceci est un test de ma voix par défaut avec le plugin Fish Audio.";
const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /api.?key|authorization|cookie|token|secret|email|user_id/i.test(key) ? "[masqué]" : redact(item)]));
  return value;
};
export default function McpDiagnostic({ signedIn }: { signedIn: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [externalMessage, setExternalMessage] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [config, setConfig] = useState<Data | null>(null);
  const [clip, setClip] = useState<Data | null>(null);
  const [checked, setChecked] = useState(false);
  const nextId = useRef(1);
  const generationId = useRef<string | null>(null);
  async function rpc(method: string, params: Data = {}, notification = false, endpoint = browserEndpoint, allowToolError = false): Promise<Data> {
    const request = { jsonrpc: "2.0", ...(!notification ? { id: nextId.current++ } : {}), method, params };
    const started = performance.now();
    const entry: Entry = { time: new Date().toISOString(), endpoint, method, ...(typeof params.name === "string" ? { tool: params.name } : {}), request, elapsed_ms: 0 };
    let recorded = false;
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" }, body: JSON.stringify(request) });
      entry.http_status = response.status;
      entry.trace_id = response.headers.get("X-Fish-Audio-Trace-Id");
      if (notification && response.status === 202) entry.response = { accepted: true };
      else if (response.headers.get("content-type")?.includes("application/json")) entry.response = redact(await response.json());
      else entry.response = { error: response.status === 401 && endpoint === "/mcp" ? "HTTP 401 sur /mcp : la connexion OAuth du client MCP est requise. La session du studio ne suffit pas pour cette URL externe." : `HTTP ${response.status} : contenu non JSON reçu avant le gestionnaire MCP.`, content_type: response.headers.get("content-type"), oauth_challenge: !!response.headers.get("WWW-Authenticate") };
      entry.elapsed_ms = Math.round(performance.now() - started);
      setEntries(previous => [...previous, entry]); recorded = true;
      if (notification && response.status === 202) return {};
      const payload = entry.response as { error?: { message?: string } | string; result?: Data };
      if (!response.ok || payload.error || (payload.result?.isError && !allowToolError)) {
        const content = payload.result?.content;
        const detail = Array.isArray(content) ? content.filter(x => x.type === "text").map(x => x.text).join(" ") : undefined;
        throw new Error(detail || (typeof payload.error === "string" ? payload.error : payload.error?.message) || `Échec HTTP ${response.status}.`);
      }
      if (!payload.result) throw new Error("Réponse JSON-RPC sans résultat.");
      return payload.result;
    } catch (error) {
      if (!recorded) { entry.elapsed_ms = Math.round(performance.now() - started); entry.error = error instanceof Error ? error.message : "Erreur réseau"; setEntries(previous => [...previous, entry]); }
      throw error;
    }
  }
  async function check() {
    setBusy(true); setChecked(false); setConfig(null); setTools([]); setMessage("");
    try {
      const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fish-audio-diagnostic", version: "1.2.0" } });
      if (init.protocolVersion !== "2025-06-18") throw new Error("Version MCP inattendue.");
      await rpc("notifications/initialized", {}, true);
      const listed = await rpc("tools/list");
      const names = Array.isArray(listed.tools) ? listed.tools.map(tool => String(tool.name)) : [];
      setTools(names);
      if (!names.includes("get_status") || !names.includes("generate_voiceover")) throw new Error("Les outils nécessaires ne sont pas exposés.");
      const status = await rpc("tools/call", { name: "get_status", arguments: {} });
      const settings = status.structuredContent as Data;
      if (!settings || typeof settings.configured !== "boolean") throw new Error("État de connexion invalide.");
      setConfig(settings); setChecked(true);
      setMessage(settings.configured ? "Le serveur MCP reconnaît ta connexion Fish Audio." : "Le serveur MCP fonctionne. Ajoute ta clé dans les réglages du studio.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Vérification impossible."); }
    finally { setBusy(false); }
  }
  async function checkExternal() {
    setBusy(true); setExternalMessage("");
    try {
      await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fish-audio-diagnostic", version: "1.2.0" } }, false, "/mcp");
      setExternalMessage("L’URL externe a répondu à l’initialisation. Une connexion OAuth complète doit encore être vérifiée dans le client MCP.");
    } catch (error) { setExternalMessage(error instanceof Error ? error.message : "Test externe impossible."); }
    finally { setBusy(false); }
  }
  async function generate() {
    if (!checked || !config?.configured || !config.default_voice || busy) return;
    setBusy(true); setMessage("");
    try {
      if (!generationId.current) {
        generationId.current = sessionStorage.getItem("fish-audio-mcp-diagnostic-request") || crypto.randomUUID();
        sessionStorage.setItem("fish-audio-mcp-diagnostic-request", generationId.current);
      }
      const result = await rpc("tools/call", { name: "generate_voiceover", arguments: { text, title: "Test du plugin Fish Audio", request_id: generationId.current } }, false, browserEndpoint, true);
      const generated = result.structuredContent as Data;
      if (!generated || typeof generated.id !== "string") {
        const content = result.content;
        throw new Error(Array.isArray(content) ? content.filter(x => x.type === "text").map(x => x.text).join(" ") || "Réponse audio invalide." : "Réponse audio invalide.");
      }
      setClip(generated);
      const verified = await rpc("tools/call", { name: "get_voiceover", arguments: { id: generated.id } }, false, browserEndpoint, true);
      const audio = verified.structuredContent as Data;
      setClip(audio);
      setMessage(audio?.status === "ready" ? "Audio généré par generate_voiceover et confirmé par get_voiceover." : typeof audio?.error === "string" ? audio.error : "La génération n’est pas prête. Consulte la réponse avant de relancer.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Test audio impossible."); }
    finally { setBusy(false); }
  }
  function prepareNewAttempt() {
    if (busy || !["interrupted", "failed"].includes(String(clip?.status))) return;
    sessionStorage.removeItem("fish-audio-mcp-diagnostic-request"); generationId.current = null; setClip(null);
    setMessage("Nouvel essai préparé. Clique sur Tester ma voix pour lancer une nouvelle synthèse. L’ancien essai reste dans l’historique.");
  }
  function downloadLogs() {
    const blob = new Blob([JSON.stringify({ server: `${location.origin}/mcp`, browser_endpoint: browserEndpoint, diagnostic_version: "1.2.0", exported_at: new Date().toISOString(), entries }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "fish-audio-diagnostic.json"; link.click(); URL.revokeObjectURL(url);
  }
  return <main className="diagnostic-page">
    <a className="brand" href="/"><img src="/fish-audio-icon.png" width={36} height={36} alt="" />Fish Audio</a>
    <div className="page-heading"><span className="eyebrow">TEST DES OUTILS DU PLUGIN · V1.2</span><h1>Diagnostic audio.</h1><p>Cette page teste les mêmes outils serveur avec ta session du studio. Chaque étape possède un identifiant pour retrouver les logs. La connexion OAuth depuis ChatGPT se vérifie séparément.</p></div>
    {!signedIn && <div className="notice error">Les appels privés nécessitent ta session ChatGPT sur ce site. La découverte des outils reste testable. <a href="/signin-with-chatgpt?return_to=%2Fdiagnostic" target="_top">Se connecter</a></div>}
    <section className="panel"><h2>1. Vérifier les outils et la connexion</h2><p className="diagnostic-copy">Initialisation → découverte des outils → lecture de ta configuration. Aucune génération à cette étape.</p><button className="primary" disabled={busy} onClick={check}>{busy ? "Test en cours…" : "Vérifier le plugin"}</button>
      {!!tools.length && <p className="diagnostic-copy"><strong>{tools.length} outils découverts :</strong> {tools.join(", ")}</p>}
      {config && <p className="diagnostic-copy">Clé configurée : {config.configured ? "oui" : "non"} · Voix par défaut : {String(config.default_voice || "non définie")} · Modèle : {String(config.model)}</p>}
    </section>
    <section className="panel"><h2>2. Générer avec ma voix par défaut</h2><p className="diagnostic-copy">Ce bouton lance une vraie génération avec ta clé enregistrée et ton modèle habituel. Les limites et le coût éventuel de ce modèle s’appliquent.</p><blockquote>{text}</blockquote><button className="primary" disabled={busy || !checked || !config?.configured || !config.default_voice || clip?.status === "ready"} onClick={generate}>Tester ma voix via le plugin</button><p className="diagnostic-copy">Une relance réutilise le même identifiant de requête pour éviter une double synthèse. Si un test échoue, consulte les logs et l’historique avant de créer un autre essai.</p>
      {clip?.status === "ready" && typeof clip.audio_url === "string" && <div className="diagnostic-audio"><audio controls src={clip.audio_url} preload="metadata" />{typeof clip.download_url === "string" && <a className="secondary" href={clip.download_url}>Télécharger le MP3</a>}</div>}
      {clip && <p className="diagnostic-copy"><strong>État audio : {String(clip.status)}</strong>{typeof clip.error === "string" ? ` · ${clip.error}` : ""}</p>}
      {["interrupted", "failed"].includes(String(clip?.status)) && <div><button className="secondary" disabled={busy} onClick={prepareNewAttempt}>Préparer un nouvel essai</button><p className="diagnostic-copy">L’essai précédent reste conservé. Une nouvelle synthèse peut être facturée par Fish Audio ; elle démarre uniquement après un nouveau clic sur Tester ma voix.</p></div>}
      {message && <div className="notice" role="status">{message}</div>}
    </section>
    <section className="panel"><h2>3. Examiner l’accès depuis un client MCP</h2><p className="diagnostic-copy">L’URL externe /mcp utilise la connexion OAuth de ChatGPT ou de MCP Inspector. Ce bouton envoie seulement une initialisation depuis ton navigateur ; un HTTP 401 indique qu’elle exige cette connexion, même si le test audio du studio fonctionne.</p><button className="secondary" disabled={busy} onClick={checkExternal}>Examiner l’URL externe /mcp</button></section>
    {externalMessage && <div className="notice" role="status">Accès externe uniquement : {externalMessage}</div>}
    <section className="panel"><div className="panel-heading"><h2>Requêtes et réponses</h2><button className="secondary" disabled={!entries.length} onClick={downloadLogs}>Exporter les logs JSON</button></div><p className="diagnostic-copy">Les clés et les en-têtes d’authentification sont exclus. Les réponses affichées restent celles de ton compte.</p>{entries.length ? entries.map((entry, i) => <details key={i} open={i === entries.length - 1}><summary>{entry.method}{entry.tool ? ` · ${entry.tool}` : ""} · {entry.http_status ?? "réseau"} · {entry.elapsed_ms} ms</summary><pre>{JSON.stringify(entry, null, 2)}</pre></details>) : <p className="diagnostic-copy">Lance la vérification pour voir les échanges.</p>}</section>
    <footer><a href="/">Retour au studio</a> · Diagnostic : {browserEndpoint} · Client MCP : /mcp</footer>
  </main>;
}
