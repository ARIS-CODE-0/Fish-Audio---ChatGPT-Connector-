import { authenticatedUser, AppError, safeMessage, parseRange } from "../../../lib/contracts.ts";
import { runtime } from "../../../lib/runtime.ts";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = authenticatedUser(request); const { service, bucket } = runtime(); const { id } = await context.params;
    const row = await service.getVoiceover(user, id);
    if (row.status !== "ready" || !row.object_key) throw new AppError("Cet audio n’est pas encore disponible.", 409);
    const head = await bucket.head(row.object_key); if (!head) throw new AppError("Fichier audio introuvable.", 404);
    const range = parseRange(request.headers.get("range"), head.size);
    const file = await bucket.get(row.object_key, range ? { range: { offset: range.start, length: range.length } } : undefined);
    if (!file) throw new AppError("Fichier audio introuvable.", 404);
    const headers = new Headers({ "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Length": String(range?.length ?? head.size) });
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${head.size}`);
    if (new URL(request.url).searchParams.has("download")) headers.set("Content-Disposition", `attachment; filename="fish-audio-${row.id}.mp3"`);
    return new Response(file.body, { status: range ? 206 : 200, headers });
  } catch (error) { return Response.json({ error: safeMessage(error) }, { status: error instanceof AppError ? error.status : 500 }); }
}
