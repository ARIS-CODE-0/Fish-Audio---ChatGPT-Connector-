import { z } from "zod";

export const MAX_SCRIPT = 1500;
export const models = ["s2.1-pro-free", "s2.1-pro"] as const;
export const voiceId = z.string().trim().regex(/^[a-zA-Z0-9_-]{8,80}$/, "Identifiant de voix invalide.");
export const generationInput = z.object({
  text: z.string().trim().min(1, "Ajoute ton texte.").max(MAX_SCRIPT, "Limite : 1 500 caractères par audio."),
  title: z.string().trim().min(1).max(100).default("Ma voix off"),
  voice_id: voiceId.optional(),
  speed: z.number().min(0.5).max(2).default(1),
  request_id: z.string().trim().regex(/^[a-zA-Z0-9_-]{8,100}$/, "Identifiant de requête invalide."),
}).strict();
export const settingsInput = z.object({
  api_key: z.string().trim().min(10).max(512).regex(/^[^\s]+$/).optional(),
  default_voice: z.union([voiceId, z.literal("")]).default(""),
  model: z.enum(models).default("s2.1-pro-free"),
}).strict();
export const searchInput = z.object({
  query: z.string().trim().max(100).default(""),
  language: z.string().regex(/^[a-z]{2,3}$/).default("fr"),
  own: z.boolean().default(false),
  page: z.number().int().min(1).max(100).default(1),
}).strict();
export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function safeMessage(error: unknown) {
  if (error instanceof AppError) return error.message;
  if (error instanceof z.ZodError) return error.issues.map(x => x.message).join(" ");
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
    return "Fish Audio n’a pas terminé à temps. Vérifie l’historique avant de relancer.";
  return "L’opération a échoué. Réessaie après avoir vérifié la configuration.";
}
export function authenticatedUser(request: Request) {
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id) throw new AppError("Connecte-toi avec ton compte ChatGPT.", 401);
  return id;
}
export function validateOrigin(request: Request, origin: string, requireOrigin = false) {
  const supplied = request.headers.get("origin");
  if ((!supplied && requireOrigin) || (supplied && supplied !== origin))
    throw new AppError("Origine de la requête refusée.", 403);
}
export function parseRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size <= 0) throw new AppError("Plage audio invalide.", 416);
  let start: number;
  let end: number;
  if (!match[1]) { const suffix = Number(match[2]); start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
    throw new AppError("Plage audio invalide.", 416);
  return { start, end, length: end - start + 1 };
}
