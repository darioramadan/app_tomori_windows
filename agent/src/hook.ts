import { HOOK_URL } from "./hooks-config.ts";

/** Forwards one hook event (stdin) to the agent. Never fails: a down agent must not disturb Claude Code. */
export async function forwardHook(input: Promise<string> = Bun.stdin.text(), url = HOOK_URL) {
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: await input, signal: AbortSignal.timeout(1000) });
  } catch {}
}
