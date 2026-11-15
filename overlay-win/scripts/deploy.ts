// Updates the installed Tomari in place, without the NSIS installer (Smart App Control blocks the unsigned
// stub electron-builder runs to make it). Only app.asar and the agent binaries change: no new Electron exe.
// Run: bun run deploy  (build the agent first with `bun run build:win` in agent/ if it changed)
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const INSTALLED = join(process.env.LOCALAPPDATA ?? "", "Programs", "tomari");
const UNPACKED = join(import.meta.dir, "..", "release", "win-unpacked", "resources");

function sh(cmd: string[]) {
  const r = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit", cwd: join(import.meta.dir, "..") });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed (${r.exitCode})`);
}

if (!existsSync(join(INSTALLED, "Tomari.exe"))) throw new Error(`Tomari is not installed in ${INSTALLED}: run the installer once`);
sh(["bun", "run", "build"]);
sh(["npx", "electron-builder", "--win", "--dir"]);

Bun.spawnSync(["taskkill", "/F", "/IM", "Tomari.exe"], { stdout: "ignore", stderr: "ignore" });
await Bun.sleep(800); // let Windows release app.asar

const copies = [join("app.asar"), join("bin", "tomari.exe"), join("bin", "tomari-agent.exe")];
for (const rel of copies) {
  const from = join(UNPACKED, rel);
  const to = join(INSTALLED, "resources", rel);
  if (existsSync(to) && readFileSync(from).equals(readFileSync(to))) continue;
  copyFileSync(from, to);
  console.log(`updated ${rel}`);
}

// The app reinstalls the agent itself when its bundled copy differs from %LOCALAPPDATA%\tomari\bin.
Bun.spawn(["cmd", "/c", "start", "", join(INSTALLED, "Tomari.exe")], { stdout: "ignore", stderr: "ignore" });
console.log("Tomari restarted");
