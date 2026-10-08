import { env } from "cloudflare:workers";
import { POST as mcpRequest } from "../../../mcp/route.ts";
import { safeMessage, validateOrigin } from "../../../../lib/contracts.ts";
export const dynamic = "force-dynamic";

// Browser diagnostics use the visitor identity verified by Sites for this API
// route. The external /mcp endpoint keeps its platform-managed OAuth boundary.
// Reuse the exact MCP handler, including per-user authorization and storage.
export async function POST(request: Request) {
  try { validateOrigin(request, env.SITE_ORIGIN ?? new URL(request.url).origin, true); }
  catch (error) { return Response.json({ error: safeMessage(error) }, { status: 403, headers: { "Cache-Control": "no-store" } }); }
  return mcpRequest(request);
}
