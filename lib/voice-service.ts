import { AppError, generationInput, settingsInput, searchInput, safeMessage } from "./contracts.ts";
import { encryptKey, decryptKey } from "./key-crypto.ts";
import { logDiagnostic } from "./diagnostics.ts";

export type Dependencies = { db: D1Database; bucket: R2Bucket; secret: string; origin: string; fetch: typeof fetch; traceId?: string; waitUntil?: (promise: Promise<unknown>) => void };
export type SettingsRow = { user_id: string; encrypted_key: string | null; default_voice: string; model: string; updated_at: string };
export type VoiceoverRow = { id: string; user_id: string; request_id: string; title: string; script: string;
  voice_id: string; model: string; speed: number; status: string; object_key: string | null;
  bytes: number | null; error: string | null; created_at: string; updated_at: string };
export function createVoiceService(deps: Dependencies) {
  const settings = (user: string) => deps.db.prepare("SELECT * FROM voice_settings WHERE user_id = ?").bind(user).first<SettingsRow>();
  async function apiKey(user: string) {
    const row = await settings(user);
    if (!row?.encrypted_key) throw new AppError(`Ajoute ta clé API Fish Audio dans ${deps.origin}/?tab=settings.`, 409);
    return { key: await decryptKey(row.encrypted_key, user, deps.secret), row };
  }
  async function fish(path: string, key: string, init: RequestInit = {}) {
    const started = Date.now();
    const traceId = deps.traceId ?? crypto.randomUUID();
    const route = path.startsWith("/v1/tts") ? "/v1/tts" as const : "/model" as const;
    let response: Response;
    try {
      response = await deps.fetch(`https://api.fish.audio${path}`, { ...init,
        redirect: "manual", signal: AbortSignal.timeout(90000),
        headers: { "Authorization": `Bearer ${key}`, ...(init.headers as Record<string, string> ?? {}) } });
    } catch (error) {
      const errorCode = error instanceof Error && ["AbortError", "TimeoutError", "TypeError"].includes(error.name) ? error.name : "fetch_error";
      logDiagnostic({ event: "fish.network_error", trace_id: traceId, route, elapsed_ms: Date.now() - started, is_error: true, error_code: errorCode });
      throw error;
    }
    logDiagnostic({ event: "fish.response", trace_id: traceId, route, http_status: response.status, elapsed_ms: Date.now() - started, is_error: !response.ok });
    if (!response.ok) {
      await response.body?.cancel();
      const messages: Record<number, string> = {
        401: "La clé API Fish Audio est invalide. Remplace-la dans les réglages.",
        402: "Le solde ou le quota Fish Audio est insuffisant pour ce modèle.",
        403: "Ton compte Fish Audio n’a pas accès à cette voix ou à ce modèle.",
        404: "Cette voix Fish Audio est introuvable.",
        422: "Fish Audio a refusé les paramètres. Vérifie la voix et le modèle.",
        429: "La limite Fish Audio est atteinte. Attends avant de relancer.",
      };
      throw new AppError(messages[response.status] ?? "Fish Audio est temporairement indisponible.", 502);
    }
    return response;
  }
  const summary = (row: VoiceoverRow) => ({
    id: row.id, request_id: row.request_id, title: row.title, text: row.script,
    voice_id: row.voice_id, model: row.model, speed: row.speed,
    status: row.status === "generating" && Date.now() - Date.parse(row.created_at) > 120000 ? "interrupted" : row.status,
    bytes: row.bytes,
    error: row.status === "generating" && Date.now() - Date.parse(row.created_at) > 120000
      ? "La génération semble interrompue. Vérifie ton compte Fish Audio avant de créer un nouvel essai." : row.error,
    created_at: row.created_at,
    audio_url: row.status === "ready" ? `${deps.origin}/audio/${row.id}` : null,
    download_url: row.status === "ready" ? `${deps.origin}/audio/${row.id}?download=1` : null,
  });
  async function getVoiceover(user: string, id: string) {
    const row = await deps.db.prepare("SELECT * FROM voiceovers WHERE user_id = ? AND id = ?").bind(user, id).first<VoiceoverRow>();
    if (!row) throw new AppError("Audio introuvable.", 404);
    // A disconnected request can leave the MP3 stored before the final DB
    // update. Recover only this authenticated user's existing object.
    if (row.status === "generating") {
      const objectKey = `voiceovers/${row.id}.mp3`;
      const file = await deps.bucket.head(objectKey);
      if (file?.size) {
        await deps.db.prepare("UPDATE voiceovers SET status='ready', object_key=?, bytes=?, updated_at=? WHERE id=? AND user_id=? AND status='generating'")
          .bind(objectKey, file.size, new Date().toISOString(), row.id, user).run();
        return { ...row, status: "ready", object_key: objectKey, bytes: file.size };
      }
    }
    return row;
  }
  async function getStatus(user: string) {
    const row = await settings(user);
    return { configured: !!row?.encrypted_key, default_voice: row?.default_voice ?? "",
      model: row?.model ?? "s2.1-pro-free", settings_url: `${deps.origin}/?tab=settings`, max_characters: 1500 };
  }
  async function saveSettings(user: string, input: unknown) {
    const data = settingsInput.parse(input);
    const current = await settings(user);
    let encrypted = current?.encrypted_key ?? null;
    if (data.api_key) {
      // Checking the voice catalogue validates credentials without synthesizing audio.
      const checked = await fish("/model?page_size=1&self=true", data.api_key);
      await checked.body?.cancel();
      encrypted = await encryptKey(data.api_key, user, deps.secret);
    }
    await deps.db.prepare(`INSERT INTO voice_settings (user_id, encrypted_key, default_voice, model, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET encrypted_key=excluded.encrypted_key,
      default_voice=excluded.default_voice, model=excluded.model, updated_at=excluded.updated_at`)
      .bind(user, encrypted, data.default_voice, data.model, new Date().toISOString()).run();
    return getStatus(user);
  }
  async function disconnect(user: string) {
    await deps.db.prepare("UPDATE voice_settings SET encrypted_key = NULL WHERE user_id = ?").bind(user).run();
    return getStatus(user);
  }
  async function listVoices(user: string, input: unknown) {
    const data = searchInput.parse(input);
    const { key } = await apiKey(user);
    const query = new URLSearchParams({ page_size: "12", page_number: String(data.page), self: String(data.own) });
    if (data.query) query.set("title", data.query);
    if (!data.own) query.set("language", data.language);
    const response = await fish(`/model?${query}`, key);
    const json = await response.json() as { items: Record<string, unknown>[]; total: number; has_more?: boolean };
    return { total: json.total, page: data.page, has_more: json.has_more ?? data.page * 12 < json.total,
      voices: (json.items ?? []).filter(x => x.type === "tts" && !x.dmca_taken_down).map(x => ({
        id: x._id, title: x.title, description: String(x.description ?? "").slice(0,240),
        languages: x.languages, tags: x.tags, visibility: x.visibility,
        voice_url: `https://fish.audio/m/${encodeURIComponent(String(x._id))}/`,
      })) };
  }
  async function listVoiceovers(user: string, limit = 20) {
    const result = await deps.db.prepare("SELECT * FROM voiceovers WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .bind(user, Math.max(1, Math.min(30, limit))).all<VoiceoverRow>();
    return { voiceovers: result.results.map(summary) };
  }
  async function generate(user: string, input: unknown) {
    const data = generationInput.parse(input);
    const previous = await deps.db.prepare("SELECT * FROM voiceovers WHERE user_id = ? AND request_id = ?")
      .bind(user, data.request_id).first<VoiceoverRow>();
    if (previous) {
      if (previous.script !== data.text || previous.speed !== data.speed || (data.voice_id && previous.voice_id !== data.voice_id))
        throw new AppError("Cet identifiant de requête appartient déjà à un autre texte. Utilise un nouvel identifiant.", 409);
      return summary(await getVoiceover(user, previous.id));
    }
    const { key, row: config } = await apiKey(user);
    const voice = data.voice_id ?? config.default_voice;
    if (!voice) throw new AppError("Choisis une voix ou enregistre une voix par défaut.", 409);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const claimed = await deps.db.prepare(`INSERT INTO voiceovers
      (id, user_id, request_id, title, script, voice_id, model, speed, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'generating', ?, ?) ON CONFLICT(user_id, request_id) DO NOTHING`)
      .bind(id, user, data.request_id, data.title, data.text, voice, config.model, data.speed, now, now).run();
    if (!claimed.meta.changes) {
      const concurrent = await deps.db.prepare("SELECT * FROM voiceovers WHERE user_id = ? AND request_id = ?")
        .bind(user, data.request_id).first<VoiceoverRow>();
      if (!concurrent) throw new AppError("Une autre génération est en cours.", 409);
      if (concurrent.script !== data.text || concurrent.speed !== data.speed || (data.voice_id && concurrent.voice_id !== data.voice_id))
        throw new AppError("Cet identifiant de requête appartient déjà à un autre texte. Utilise un nouvel identifiant.", 409);
      return summary(concurrent);
    }
    async function completeGeneration() {
      let persisted = false;
      try {
        const response = await fish("/v1/tts", key, { method: "POST",
          headers: { "Content-Type": "application/json", "model": config.model },
          body: JSON.stringify({ text: data.text, reference_id: voice, format: "mp3", mp3_bitrate: 192,
            latency: "normal", prosody: { speed: data.speed, volume: 0, normalize_loudness: true } }) });
        if (response.headers.get("content-type")?.includes("json") || !response.body)
          throw new AppError("Fish Audio n’a pas renvoyé de fichier audio.", 502);
        const reader = response.body.getReader();
        const parts: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const next = await reader.read(); if (next.done) break;
          length += next.value.byteLength;
          if (length > 16 * 1024 * 1024) { await reader.cancel(); throw new AppError("Ce fichier audio dépasse la limite de 16 Mo.", 413); }
          parts.push(next.value);
        }
        if (!length) throw new AppError("Fish Audio a renvoyé un fichier vide.", 502);
        const audio = new Uint8Array(length); let offset = 0;
        for (const part of parts) { audio.set(part, offset); offset += part.length; }
        const objectKey = `voiceovers/${id}.mp3`;
        await deps.bucket.put(objectKey, audio, { httpMetadata: { contentType: "audio/mpeg" } });
        persisted = true;
        await deps.db.prepare("UPDATE voiceovers SET status='ready', object_key=?, bytes=?, updated_at=? WHERE id=? AND user_id=?")
          .bind(objectKey, length, new Date().toISOString(), id, user).run();
        return summary(await getVoiceover(user, id));
      } catch (error) {
        // Preserve an audio which was stored successfully even if the final DB write was interrupted.
        if (persisted) await deps.db.prepare("UPDATE voiceovers SET status='ready', object_key=?, updated_at=? WHERE id=? AND user_id=?")
          .bind(`voiceovers/${id}.mp3`, new Date().toISOString(), id, user).run();
        else await deps.db.prepare("UPDATE voiceovers SET status='failed', error=?, updated_at=? WHERE id=? AND user_id=?")
          .bind(safeMessage(error), new Date().toISOString(), id, user).run();
        if (persisted) return summary(await getVoiceover(user, id));
        throw error;
      }
    }
    const work = completeGeneration();
    // Keep this single synthesis alive if the browser or MCP client disconnects.
    // Workers grants at most 30 seconds after disconnect; this is not a queue.
    deps.waitUntil?.(work.then(() => undefined, () => undefined));
    return work;
  }
  return { getStatus, saveSettings, disconnect, listVoices, listVoiceovers, generate, getVoiceover, summary };
}
