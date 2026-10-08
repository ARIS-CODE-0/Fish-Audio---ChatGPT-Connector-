import { runtime } from "../../../lib/runtime.ts";
import { authenticatedUser, validateOrigin, AppError, safeMessage } from "../../../lib/contracts.ts";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: unknown) => json({ error: safeMessage(error) }, error instanceof AppError ? error.status : 400);
export async function GET(request: Request) {
  try {
    const user = authenticatedUser(request); const { service } = runtime(); const query = new URL(request.url).searchParams;
    const action = query.get("action") ?? "status";
    if (action === "status") return json(await service.getStatus(user));
    if (action === "history") return json(await service.listVoiceovers(user));
    if (action === "voices") return json(await service.listVoices(user, { query: query.get("query") ?? "", language: query.get("language") ?? "fr", own: query.get("own") === "true", page: Number(query.get("page") ?? 1) }));
    throw new AppError("Action inconnue.", 404);
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const user = authenticatedUser(request); const { service, origin } = runtime(); validateOrigin(request, origin, true);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new AppError("Format JSON requis.", 415);
    const raw = await request.text(); if (raw.length > 16000) throw new AppError("Requête trop volumineuse.", 413);
    let input: { action?: string; data?: unknown }; try { input = JSON.parse(raw); } catch { throw new AppError("JSON invalide."); }
    if (input.action === "settings") return json(await service.saveSettings(user, input.data));
    if (input.action === "disconnect") return json(await service.disconnect(user));
    if (input.action === "generate") return json(await service.generate(user, input.data));
    throw new AppError("Action inconnue.", 404);
  } catch (error) { return fail(error); }
}
