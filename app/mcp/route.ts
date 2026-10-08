import { env } from "cloudflare:workers";
import { handleMcp } from "../../lib/mcp.ts";
import { runtime } from "../../lib/runtime.ts";
import { validateOrigin, safeMessage } from "../../lib/contracts.ts";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleMcp(request, env.SITE_ORIGIN ?? new URL(request.url).origin, traceId => runtime(traceId).service); }
export async function GET(request: Request) {
  try { validateOrigin(request, env.SITE_ORIGIN ?? new URL(request.url).origin); }
  catch (error) { return Response.json({ error: safeMessage(error) }, { status: 403 }); }
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
export const DELETE = GET;
