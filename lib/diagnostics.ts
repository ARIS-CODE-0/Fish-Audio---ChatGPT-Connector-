type Diagnostic = {
  event: "mcp.request" | "mcp.response" | "fish.response" | "fish.network_error";
  trace_id: string;
  method?: string;
  tool?: string;
  route?: "/model" | "/v1/tts";
  http_status?: number;
  elapsed_ms?: number;
  is_error?: boolean;
  error_code?: number | string;
};

// Callers supply only protocol names, fixed routes and status codes. Never log
// arguments, scripts, identities, API keys, cookies or authorization headers.
export function logDiagnostic(event: Diagnostic) {
  console.info(JSON.stringify({ source: "fish-audio", ...event }));
}
