import { getChatGPTUser } from "../chatgpt-auth";
import McpDiagnostic from "./tester";
export const dynamic = "force-dynamic";
export default async function DiagnosticPage() {
  return <McpDiagnostic signedIn={!!await getChatGPTUser()} />;
}
