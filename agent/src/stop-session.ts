/** Stops a background session with `claude stop`; its conversation is kept and can be resumed later. */
import { claudeBin } from "./config.ts";
import { backgroundId, run, type OpenResult } from "./open-session.ts";
import { isSessionId } from "./protocol-guard.ts";

/** `runner` is replaceable so tests never stop a real session. */
export async function stopSession(sessionId: string, runner: (command: string[]) => Promise<OpenResult> = run): Promise<OpenResult> {
  if (!isSessionId(sessionId)) return { ok: false, error: "invalid session id" };
  return runner([claudeBin(), "stop", backgroundId(sessionId)]);
}
