import { runAgent } from "./agent.ts";
import { parseCommand, USAGE } from "./cli.ts";
import { setup, uninstall } from "./install.ts";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LOG_DIR } from "./config.ts";
import { forwardHook } from "./hook.ts";
import { status } from "./status.ts";

declare const TOMARI_VERSION: string | undefined;
const VERSION = typeof TOMARI_VERSION === "string" ? TOMARI_VERSION : "dev";

const command = parseCommand(process.argv.slice(2));
try {
  switch (command.name) {
    case "agent":
      if (command.log) logToFile(join(LOG_DIR, "agent.log"));
      await runAgent();
      break;
    case "hook":
      await forwardHook();
      process.exit(0);
      break;
    case "setup":
      await setup();
      break;
    case "status":
      await status(VERSION);
      break;
    case "uninstall":
      await uninstall({ purge: command.purge });
      break;
    case "version":
      console.log(VERSION);
      break;
    case "help":
      if (command.error) console.error(`tomari: ${command.error}\n`);
      console.log(USAGE);
      process.exit(command.error ? 1 : 0);
  }
} catch (error) {
  console.error(`tomari: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

/** The autostarted agent has no console: its output goes to a file. */
function logToFile(path: string) {
  mkdirSync(LOG_DIR, { recursive: true });
  const write = (...args: unknown[]) => {
    try {
      appendFileSync(path, args.map((a) => (typeof a === "string" ? a : a instanceof Error ? a.stack ?? a.message : JSON.stringify(a))).join(" ") + "\n");
    } catch {}
  };
  console.log = write;
  console.error = write;
}
