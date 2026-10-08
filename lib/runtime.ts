import { env, waitUntil } from "cloudflare:workers";
import { AppError } from "./contracts.ts";
import { createVoiceService } from "./voice-service.ts";
export function runtime(traceId = crypto.randomUUID()) {
  if (!env.DB || !env.BUCKET || !env.FISH_KEY_ENCRYPTION_SECRET || !env.SITE_ORIGIN)
    throw new AppError("La configuration du serveur n’est pas encore prête.", 503);
  const deps = { db: env.DB, bucket: env.BUCKET, secret: env.FISH_KEY_ENCRYPTION_SECRET,
    origin: env.SITE_ORIGIN, fetch: globalThis.fetch.bind(globalThis), traceId, waitUntil };
  return { ...deps, service: createVoiceService(deps) };
}
