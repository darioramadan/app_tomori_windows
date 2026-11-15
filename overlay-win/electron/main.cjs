// Tomari for Windows: the floating strip, its tray icon, and keeping the agent installed and running.
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(process.env.LOCALAPPDATA || "", "tomari");
const BIN_DIR = path.join(DATA_DIR, "bin");
const PREFS_FILE = path.join(DATA_DIR, "overlay.json");
const HEALTH_URL = "http://127.0.0.1:7778/health";
// tomari.exe and tomari-agent.exe ship inside the app; dev runs use the agent's build output.
const SHIPPED_BIN = app.isPackaged ? path.join(process.resourcesPath, "bin") : path.join(__dirname, "..", "..", "dist", "win");

const DEFAULT_PREFS = { edge: "right", sound: false, hidden: false, collapsed: false };
let prefs = { ...DEFAULT_PREFS, ...readJson(PREFS_FILE) };
let layout = [0, 0];
let frontApp = "other";
let waiting = 0;
let win = null;
let tray = null;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function savePrefs() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
  } catch {}
}

// ---- agent ----

async function agentAnswers() {
  try {
    return (await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

/** The installed agent differs from the one this app ships (an app update). */
function agentOutdated() {
  // `bun build --compile` appends the bundled code at the end of the exe, and rebuilds often keep the size:
  // compare the size and the last 8 MB instead of hashing two 100 MB files.
  const tail = (dir) => {
    let fd;
    try {
      fd = fs.openSync(path.join(dir, "tomari-agent.exe"), "r");
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 8 * 1024 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return { size, buf };
    } catch {
      return null;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  };
  const a = tail(BIN_DIR);
  const b = tail(SHIPPED_BIN);
  return !a || !b || a.size !== b.size || !a.buf.equals(b.buf);
}

/** `tomari.exe setup` copies the binaries to %LOCALAPPDATA%\tomari\bin, adds the Claude Code hooks and starts the agent. */
function runSetup() {
  return new Promise((resolve) => {
    execFile(path.join(SHIPPED_BIN, "tomari.exe"), ["setup"], { windowsHide: true, timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) console.error("tomari setup failed:", error.message, stderr);
      else console.log(stdout);
      resolve();
    });
  });
}

async function ensureAgent() {
  if (!fs.existsSync(path.join(SHIPPED_BIN, "tomari.exe"))) return console.error(`no tomari.exe in ${SHIPPED_BIN}`);
  if (!(await agentAnswers()) || agentOutdated()) await runSetup();
}

// ---- window ----

/** Docks the window on the primary display's work area, vertically centered. */
function applyLayout() {
  const [lw, lh] = layout;
  if (!win || lw <= 0) return null;
  const wa = screen.getPrimaryDisplay().workArea;
  const w = Math.min(Math.round(lw), wa.width);
  const h = Math.min(Math.round(lh), wa.height);
  const x = prefs.edge === "right" ? wa.x + wa.width - w : wa.x;
  win.setBounds({ x, y: wa.y + Math.round((wa.height - h) / 2), width: w, height: h });
  if (!prefs.hidden && !win.isVisible()) win.showInactive();
  return [w, h];
}

function createWindow() {
  win = new BrowserWindow({
    width: 80,
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false, // never steals focus from Claude or Antigravity
    backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), autoplayPolicy: "no-user-gesture-required" },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true, { forward: true }); // the page turns this off over the strip
  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

// ---- tray ----

function buildTrayMenu() {
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: prefs.hidden ? "Mostrar tira" : "Ocultar tira", click: () => changePrefs({ hidden: !prefs.hidden }) },
      { label: "Borde izquierdo", type: "radio", checked: prefs.edge === "left", click: () => changePrefs({ edge: "left" }) },
      { label: "Borde derecho", type: "radio", checked: prefs.edge === "right", click: () => changePrefs({ edge: "right" }) },
      { label: "Sonido al terminar", type: "checkbox", checked: prefs.sound, click: () => changePrefs({ sound: !prefs.sound }) },
      { type: "separator" },
      { label: `${waiting} esperando`, enabled: false },
      { type: "separator" },
      { label: "Salir", click: () => app.quit() },
    ]),
  );
}

function changePrefs(change) {
  prefs = { ...prefs, ...change };
  savePrefs();
  if (!win || !tray) return; // still starting: the window picks the prefs up when it loads
  buildTrayMenu();
  if (prefs.hidden) win.hide();
  else if (applyLayout()) win.showInactive(); // no layout yet: the page's first set_layout shows it
  win.webContents.send("prefs", prefs);
}

let ignoring = true;
function setIgnore(ignore) {
  ignoring = ignore;
  win?.setIgnoreMouseEvents(ignore, { forward: true });
}

/** The page can miss the cursor leaving (a fast flick): then let clicks through again ourselves. */
function watchCursorLeaving() {
  setInterval(() => {
    if (ignoring || !win || !win.isVisible()) return;
    const { x, y } = screen.getCursorScreenPoint();
    const b = win.getBounds();
    if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) return;
    setIgnore(true);
    win.webContents.send("mouse-out");
  }, 100);
}

const workHeight = () => screen.getPrimaryDisplay().workArea.height;

// ---- foreground app ----

/** "desktop" (Claude), "antigravity" or "other"; null while our own process is in front (the tray menu). */
function makeFrontAppReader() {
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    const kernel32 = koffi.load("kernel32.dll");
    const GetForegroundWindow = user32.func("void* __stdcall GetForegroundWindow()");
    const GetWindowThreadProcessId = user32.func("uint32 __stdcall GetWindowThreadProcessId(void* hwnd, _Out_ uint32* pid)");
    const OpenProcess = kernel32.func("void* __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)");
    const QueryFullProcessImageNameW = kernel32.func("int __stdcall QueryFullProcessImageNameW(void* h, uint32 flags, _Out_ uint16* buf, _Inout_ uint32* size)");
    const CloseHandle = kernel32.func("int __stdcall CloseHandle(void* h)");
    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    return () => {
      const hwnd = GetForegroundWindow();
      if (!hwnd) return "other";
      const pid = [0];
      GetWindowThreadProcessId(hwnd, pid);
      if (pid[0] === process.pid) return null;
      const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid[0]);
      if (!h) return "other";
      const buf = new Uint16Array(520);
      const len = [buf.length];
      const ok = QueryFullProcessImageNameW(h, 0, buf, len);
      CloseHandle(h);
      if (!ok) return "other";
      const exe = path.basename(String.fromCharCode(...buf.subarray(0, len[0]))).toLowerCase();
      return exe === "claude.exe" ? "desktop" : exe === "antigravity.exe" ? "antigravity" : "other";
    };
  } catch (error) {
    console.error("foreground app detection unavailable:", error.message);
    return () => "other";
  }
}

// ---- app ----

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => changePrefs({ hidden: false }));
  app.on("window-all-closed", (e) => e.preventDefault());

  ipcMain.handle("get_init", () => ({ prefs, frontApp, workHeight: workHeight() }));
  // Asked on every connect: setup (re-run by the watchdog) may have created a new token.
  ipcMain.handle("get_token", () => readJson(path.join(DATA_DIR, "config.json")).token ?? null);
  ipcMain.handle("set_ignore_mouse", (_e, { ignore }) => setIgnore(ignore));
  ipcMain.handle("set_layout", (_e, { width, height }) => {
    layout = [width, height];
    return applyLayout();
  });
  ipcMain.handle("set_pref", (_e, { key, value }) => {
    if (key === "collapsed") prefs.collapsed = Boolean(value);
    savePrefs();
  });
  ipcMain.handle("set_waiting", (_e, { count }) => {
    if (count === waiting) return;
    waiting = count;
    buildTrayMenu();
  });

  app.whenReady().then(async () => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
    await ensureAgent(); // before the window: it creates the token the strip pairs with
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.ico")));
    tray.setToolTip("Tomari");
    tray.on("click", () => changePrefs({ hidden: !prefs.hidden }));
    buildTrayMenu();
    createWindow();
    watchCursorLeaving();
    screen.on("display-metrics-changed", () => {
      applyLayout();
      win?.webContents.send("work-height", workHeight());
    });

    const readFront = makeFrontAppReader();
    setInterval(() => {
      const now = readFront();
      if (now && now !== frontApp) {
        frontApp = now;
        win?.webContents.send("front-app", frontApp);
        win?.setAlwaysOnTop(true, "screen-saver"); // a fullscreen app may have pushed us under it
      }
    }, 500);
    // The agent may die (or be killed by an update); bring it back.
    setInterval(async () => {
      if (!(await agentAnswers())) await ensureAgent();
    }, 60_000);
  });
}
