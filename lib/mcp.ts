import { AppError, authenticatedUser, safeMessage, validateOrigin } from "./contracts.ts";
import { createVoiceService } from "./voice-service.ts";
import { logDiagnostic } from "./diagnostics.ts";
type Service = ReturnType<typeof createVoiceService>;
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
// Sites owns OAuth and its scopes. These tools require the visitor identity
// verified by Sites, never a model-supplied bearer token or user identifier.
const securitySchemes = [{ type: "oauth2", scopes: [] as string[] }];
export const toolDefinitions = [
  { name: "get_status", title: "Vérifier Fish Audio", description: "Lire l’état de la connexion Fish Audio, la voix par défaut et le lien de configuration. La clé API n’est jamais renvoyée.", inputSchema: objectSchema({}), annotations: read },
  { name: "list_voices", title: "Chercher des voix", description: "Chercher des voix Fish Audio par langue et titre, ou lister les voix du compte. Utiliser les identifiants réels renvoyés.", inputSchema: objectSchema({
    query: { type: "string", maxLength: 100 }, language: { type: "string", default: "fr", description: "Code langue, par exemple fr ou en." },
    own: { type: "boolean", default: false, description: "Vrai pour les voix privées du compte." }, page: { type: "integer", minimum: 1, maximum: 100, default: 1 },
  }), annotations: { ...read, openWorldHint: true } },
  { name: "generate_voiceover", title: "Générer une voix off MP3", description: "Transformer le texte autorisé en MP3 avec la voix par défaut ou un voice_id réel. Le modèle est celui choisi dans les réglages. Conserver request_id pour tout nouvel essai de cette requête afin d’éviter une double génération. Ne jamais relancer automatiquement avec un nouvel identifiant après une erreur ou un état generating/interrupted. Limite : 1 500 caractères.", inputSchema: objectSchema({
    text: { type: "string", minLength: 1, maxLength: 1500, description: "Texte exact à prononcer." }, title: { type: "string", minLength: 1, maxLength: 100 },
    voice_id: { type: "string", pattern: "^[a-zA-Z0-9_-]{8,80}$" }, speed: { type: "number", minimum: 0.5, maximum: 2, default: 1 },
    request_id: { type: "string", pattern: "^[a-zA-Z0-9_-]{8,100}$", description: "Identifiant unique créé une fois, par exemple un UUID. Réutiliser exactement cet identifiant pour réessayer cette génération." },
  }, ["text", "request_id"]), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  { name: "list_voiceovers", title: "Retrouver mes audios", description: "Lire les 20 derniers audios du compte et leurs liens privés de téléchargement.", inputSchema: objectSchema({}), annotations: read },
  { name: "get_voiceover", title: "Consulter une voix off", description: "Lire l’état d’une génération et son fichier MP3, sans nouvelle synthèse.", inputSchema: objectSchema({ id: { type: "string", minLength: 1, maxLength: 100 } }, ["id"]), annotations: read },
].map(tool => ({ ...tool, securitySchemes, _meta: { securitySchemes } }));
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const rpcError = (id: unknown, code: number, message: string, status = 200) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);
export async function handleMcp(request: Request, origin: string, service: (traceId: string) => Service) {
  const traceId = crypto.randomUUID();
  const started = Date.now();
  const response = await handleRequest(request, origin, () => service(traceId), traceId);
  response.headers.set("X-Fish-Audio-Trace-Id", traceId);
  let isError = !response.ok;
  let errorCode: number | undefined;
  if (response.headers.get("content-type")?.includes("application/json")) {
    const payload = await response.clone().json() as { error?: { code?: number }; result?: { isError?: boolean } };
    isError ||= !!payload.error || !!payload.result?.isError;
    if (typeof payload.error?.code === "number") errorCode = payload.error.code;
  }
  logDiagnostic({ event: "mcp.response", trace_id: traceId, http_status: response.status, elapsed_ms: Date.now() - started, is_error: isError, ...(errorCode === undefined ? {} : { error_code: errorCode }) });
  return response;
}
async function handleRequest(request: Request, origin: string, service: () => Service, traceId: string) {
  try { validateOrigin(request, origin); } catch (error) { return rpcError(null, -32000, safeMessage(error), 403); }
  if (!request.headers.get("content-type")?.includes("application/json")) return rpcError(null, -32600, "Content-Type application/json requis.", 415);
  let message: Record<string, unknown>;
  try { const raw = await request.text(); if (raw.length > 32000) return rpcError(null, -32600, "Requête trop volumineuse.", 413); message = JSON.parse(raw); }
  catch { return rpcError(null, -32700, "JSON invalide.", 400); }
  if (!message || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(null, -32600, "Requête JSON-RPC invalide.", 400);
  const knownMethods = ["initialize", "ping", "tools/list", "tools/call", "notifications/initialized"];
  const suppliedTool = (message.params && typeof message.params === "object" ? (message.params as Record<string, unknown>).name : undefined);
  const knownTool = toolDefinitions.find(tool => tool.name === suppliedTool)?.name;
  logDiagnostic({ event: "mcp.request", trace_id: traceId, method: knownMethods.includes(message.method) ? message.method : "unknown", ...(knownTool ? { tool: knownTool } : {}) });
  if (message.id === undefined) {
    if (!message.method.startsWith("notifications/")) return rpcError(null, -32600, "Identifiant de requête manquant.", 400);
    return new Response(null, { status: 202 });
  }
  if (typeof message.id !== "string" && typeof message.id !== "number") return rpcError(null, -32600, "Identifiant JSON-RPC invalide.", 400);
  if (message.params !== undefined && (!message.params || Array.isArray(message.params) || typeof message.params !== "object")) return rpcError(message.id, -32602, "Paramètres JSON-RPC invalides.", 400);
  const params = (message.params ?? {}) as Record<string, unknown>;
  const result = (value: unknown) => json({ jsonrpc: "2.0", id: message.id, result: value });
  if (message.method === "initialize") {
    const supported = ["2025-03-26", "2025-06-18"];
    return result({ protocolVersion: supported.includes(String(params.protocolVersion)) ? params.protocolVersion : "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "fish-audio", title: "Fish Audio", version: "1.3.0", icons: [{ src: "https://fish.audio/favicon-96x96.png", mimeType: "image/png", sizes: ["96x96"] }] },
      instructions: "Fish Audio est une intégration indépendante pour rechercher des voix et générer des voix off. Commencer par get_status. Si configured=false, donner settings_url et inviter l’utilisateur à y ajouter sa clé ; ne jamais demander une clé API dans la conversation. Une fois connecté, utiliser directement list_voices pour chercher des voix dans la langue demandée. Recommander une voix réelle selon son titre, sa description, sa langue et le ton demandé ; ne pas demander à l’utilisateur de chercher lui-même un identifiant. Respecter une voix explicitement demandée et utiliser la voix par défaut lorsqu’elle convient. Si aucune voix ne correspond sur la première page, affiner la recherche ou consulter la page suivante. Ne jamais inventer un identifiant. Lorsque l’utilisateur autorise une génération, conserver son texte et retourner les liens du MP3. Le site et les audios sont privés. Le modèle payant est choisi uniquement dans les réglages du propriétaire. Ne pas présenter un audio en cours ou en échec comme terminé." });
  }
  if (message.method === "ping") return result({});
  if (message.method === "tools/list") return result({ tools: toolDefinitions });
  if (message.method !== "tools/call") return rpcError(message.id, -32601, "Méthode inconnue.");
  const name = params.name;
  if (!toolDefinitions.some(tool => tool.name === name)) return rpcError(message.id, -32602, "Outil inconnu.");
  let user: string;
  try { user = authenticatedUser(request); } catch (error) {
    // Let both the HTTP MCP transport and ChatGPT's tool-level OAuth UI
    // recognize the missing connection. Discovery remains public.
    const challenge = 'Bearer error="invalid_token", error_description="Sign in with ChatGPT to use Fish Audio"';
    const response = json({ jsonrpc: "2.0", id: message.id, result: {
      isError: true, content: [{ type: "text", text: safeMessage(error) }],
      _meta: { "mcp/www_authenticate": [challenge] },
    } }, 401);
    response.headers.set("WWW-Authenticate", challenge);
    return response;
  }
  try {
    const api = service(); const args = params.arguments ?? {};
    if (!args || Array.isArray(args) || typeof args !== "object") throw new AppError("Arguments invalides.");
    let data: Record<string, unknown>;
    if (name === "get_status" || name === "list_voiceovers") {
      if (Object.keys(args).length) throw new AppError("Cet outil ne prend aucun argument.");
      data = name === "get_status" ? await api.getStatus(user) : await api.listVoiceovers(user);
    } else if (name === "list_voices") data = await api.listVoices(user, args);
    else if (name === "generate_voiceover") data = await api.generate(user, args);
    else { const id = (args as Record<string, unknown>).id;
      if (typeof id !== "string" || !id || id.length > 100 || Object.keys(args).some(k => k !== "id")) throw new AppError("Identifiant audio invalide.");
      data = api.summary(await api.getVoiceover(user, id)); }
    const content: Record<string, unknown>[] = [{ type: "text", text: JSON.stringify(data) }];
    if (typeof data.audio_url === "string") content.push({ type: "resource_link", uri: data.audio_url, name: `${String(data.title ?? "voix-off")}.mp3`, mimeType: "audio/mpeg", description: "Audio MP3 privé. Ouvrir avec le compte ChatGPT du propriétaire." });
    return result({ content, structuredContent: data, isError: data.status === "failed" || data.status === "interrupted" });
  } catch (error) { return result({ isError: true, content: [{ type: "text", text: safeMessage(error) }] }); }
}
