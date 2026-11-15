import { existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BIN_DIR, CLAUDE_SETTINGS, DATA_DIR, LOG_DIR, loadConfig } from "./config.ts";
import { register, start, stop, tomariJobs, unregister } from "./autostart.ts";
import { writeHooks } from "./settings.ts";

/** What a build ships next to tomari.exe, and setup copies into BIN_DIR. */
const SHIPPED = ["tomari.exe", "tomari-agent.exe"];

export async function setup() {
  const source = dirname(process.execPath);
  const missing = SHIPPED.filter((name) => !existsSync(join(source, name)));
  if (missing.length > 0) throw new Error(`${missing.join(", ")} not found next to ${process.execPath}; run setup from a build`);
  const jobs = tomariJobs(BIN_DIR);

  for (const job of jobs) await stop(job);
  if (source.toLowerCase() !== BIN_DIR.toLowerCase()) await copyInto(source, BIN_DIR);
  await loadConfig(); // creates the token before the overlay looks for it
  await mkdir(LOG_DIR, { recursive: true });
  const hooksChanged = await writeHooks({ install: true });
  for (const job of jobs) {
    await register(job);
    start(job);
  }

  console.log(`Tomari is installed and running.
  binaries : ${BIN_DIR}
  data     : ${DATA_DIR}
  logs     : ${LOG_DIR}
  hooks    : ${hooksChanged ? "added to" : "already in"} ${CLAUDE_SETTINGS}`);
}

/** A hook may be running tomari.exe right now, holding the file: retry briefly. */
async function copyInto(source: string, target: string) {
  await mkdir(target, { recursive: true });
  for (const name of SHIPPED) {
    for (let attempt = 1; ; attempt++) {
      try {
        await copyFile(join(source, name), join(target, name));
        break;
      } catch (error) {
        if (attempt >= 20) throw error;
        await Bun.sleep(250);
      }
    }
  }
}

export async function uninstall({ purge }: { purge: boolean }) {
  const hooksRemoved = await writeHooks({ install: false });
  for (const job of tomariJobs(BIN_DIR)) {
    await unregister(job);
    await stop(job);
  }
  await rm(BIN_DIR, { recursive: true, force: true }).catch(() => {
    console.log(`  could not delete ${BIN_DIR} (in use?); delete it by hand`);
  });

  const deleteData = purge || (process.stdin.isTTY && prompt(`Delete your pins and icons in ${DATA_DIR}? [y/N]`)?.trim().toLowerCase() === "y");
  if (deleteData) await rm(DATA_DIR, { recursive: true, force: true }).catch(() => {});

  console.log(`Tomari is uninstalled.
  hooks : ${hooksRemoved ? "removed from" : "were not in"} ${CLAUDE_SETTINGS}
  data  : ${deleteData ? "deleted" : `kept in ${DATA_DIR}`}`);
}
