// Thin client for Bolna's REST API (https://www.bolna.ai/docs/api-reference).
// Placing a call returns an execution_id; we then ask for that execution until
// it finishes, so no public webhook (and no tunnel) is needed on a laptop.

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

export interface BolnaConfig { apiKey: string; agentId: string; baseUrl?: string; fromNumber?: string; fetchImpl?: FetchLike }

export interface BolnaExecution {
  id?: string;
  status?: string;
  conversation_duration?: number;
  transcript?: string | null;
  extracted_data?: unknown;
  error_message?: string | null;
  answered_by_voice_mail?: boolean | null;
  telephony_data?: { recording_url?: string | null } | null;
}

const base = (c: BolnaConfig) => (c.baseUrl || "https://api.bolna.ai").replace(/\/+$/, "");
const headers = (c: BolnaConfig) => ({ Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" });
const doFetch = (c: BolnaConfig): FetchLike => c.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>);

export async function startBolnaCall(c: BolnaConfig, input: { toPhone: string; userData: Record<string, string> }): Promise<{ executionId: string }> {
  const body: Record<string, unknown> = { agent_id: c.agentId, recipient_phone_number: input.toPhone, user_data: input.userData };
  if (c.fromNumber) body.from_phone_number = c.fromNumber;
  const res = await doFetch(c)(`${base(c)}/call`, { method: "POST", headers: headers(c), body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const j = (await res.json().catch(() => ({}))) as { execution_id?: string; message?: string };
  if (!res.ok || !j.execution_id) throw new Error(`Bolna could not start the call (${res.status}${j.message ? `: ${j.message}` : ""})`);
  return { executionId: j.execution_id };
}

export async function getBolnaExecution(c: BolnaConfig, executionId: string): Promise<BolnaExecution> {
  const res = await doFetch(c)(`${base(c)}/executions/${encodeURIComponent(executionId)}`, { headers: headers(c), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Bolna could not look up the call (${res.status})`);
  return (await res.json()) as BolnaExecution;
}

export type AttemptStatus = "CALLING" | "DONE" | "NO_ANSWER" | "BUSY" | "NO_CONVERSATION" | "FAILED";

const ACTIVE = new Set(["scheduled", "queued", "rescheduled", "initiated", "ringing", "in-progress", "call-disconnected"]);
const FAILED = new Set(["failed", "error", "canceled", "stopped", "balance-low"]);

const FRIENDLY: Record<string, string> = {
  "no-answer": "Nobody answered the call.",
  busy: "The line was busy.",
  "balance-low": "Your Bolna balance is too low to place the call.",
  canceled: "The call was cancelled.",
  stopped: "The call was stopped.",
};

// Turns Bolna's many statuses into the few the screen needs. "completed" alone
// is not enough: the call must have had real talk time and the buyer must have
// said something, otherwise there is nothing to read.
export function mapExecution(e: BolnaExecution): { status: AttemptStatus; message: string | null } {
  const s = (e.status ?? "").toLowerCase();
  if (ACTIVE.has(s)) return { status: "CALLING", message: null };
  if (s === "no-answer") return { status: "NO_ANSWER", message: FRIENDLY["no-answer"] };
  if (s === "busy") return { status: "BUSY", message: FRIENDLY.busy };
  if (FAILED.has(s)) return { status: "FAILED", message: FRIENDLY[s] ?? e.error_message ?? "The call failed." };
  if (s === "completed") {
    // Bolna's own voicemail detection hung up: tell the person, because it can misfire on a real person
    if (e.answered_by_voice_mail === true && !/^\s*user\s*:/im.test(e.transcript ?? "")) {
      return { status: "NO_CONVERSATION", message: "Bolna thought this was a voicemail and hung up. If a person answered, turn off Voicemail Detection in the agent's Calling tab and try again." };
    }
    const spoke = /^\s*user\s*:/im.test(e.transcript ?? "");
    if (!(Number(e.conversation_duration) > 0) || !spoke) return { status: "NO_CONVERSATION", message: "The call connected but the buyer did not speak, so there is nothing to read." };
    return { status: "DONE", message: null };
  }
  return { status: "CALLING", message: null }; // unknown status: keep waiting, the timeout catches a stuck call
}
