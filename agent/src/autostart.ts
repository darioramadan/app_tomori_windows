/**
 * Starts Tomari at login and now, without admin: one value per program under HKCU\...\Run, and
 * detached processes. tomari-agent.exe and tomari-overlay.exe are GUI-subsystem builds, so no console shows.
 */
import { spawn } from "node:child_process";
import { basename, join } from "node:path";
import { run } from "./open-session.ts";

const RUN_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`;

export interface Job {
  /** Registry value name. */
  name: string;
  exe: string;
  args: string[];
}

/** The overlay is the Tomari app itself, which registers its own login item. */
export function tomariJobs(binDir: string): Job[] {
  return [{ name: "TomariAgent", exe: join(binDir, "tomari-agent.exe"), args: ["agent", "--log"] }];
}

const imageName = (job: Job) => basename(job.exe);

/** The command line Windows runs at login. */
export const runValue = (job: Job) => [`"${job.exe}"`, ...job.args].join(" ");

export async function register(job: Job) {
  const result = await run(["reg", "add", RUN_KEY, "/v", job.name, "/t", "REG_SZ", "/d", runValue(job), "/f"]);
  if (!result.ok) throw new Error(`could not register ${job.name} at login: ${result.error}`);
}

export async function unregister(job: Job) {
  await run(["reg", "delete", RUN_KEY, "/v", job.name, "/f"]); // missing is fine
}

export async function isRegistered(job: Job) {
  return (await run(["reg", "query", RUN_KEY, "/v", job.name])).ok;
}

export function start(job: Job) {
  spawn(job.exe, job.args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/** Kills every process of the job's image; waits a moment so its files can be replaced. */
export async function stop(job: Job) {
  // Never this process: setup may be running as that very image.
  await run(["taskkill", "/F", "/IM", imageName(job), "/FI", `PID ne ${process.pid}`]); // none running is fine
  await Bun.sleep(300);
}

/** Pid of the running job, if any. */
export async function pidOf(job: Job): Promise<number | null> {
  const proc = Bun.spawn(["tasklist", "/FI", `IMAGENAME eq ${imageName(job)}`, "/FO", "CSV", "/NH"], { stdout: "pipe", stderr: "ignore", windowsHide: true });
  const out = await new Response(proc.stdout).text();
  const pid = out.match(/^"[^"]+","(\d+)"/m)?.[1];
  return pid ? Number(pid) : null;
}

/** "running (pid 123)", "not running" or "not installed". */
export async function describe(job: Job) {
  if (!(await isRegistered(job))) return "not installed";
  const pid = await pidOf(job);
  return pid ? `running (pid ${pid})` : "not running";
}
