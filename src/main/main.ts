import { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, dialog, screen } from "electron";
import { join } from "path";
import { appendFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { DNS_PROVIDERS, getProvider } from "./providers";
import {
  flushDns,
  getAdapters,
  getAllDns,
  getDnsSource,
  isAdmin,
  matchProviderId,
  setAdapterDns,
} from "./dnsManager";
import { benchmarkAll, benchmarkProvider, pingHost } from "./benchmark";
import { AppSettings, loadSettings, saveSettings } from "./store";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let crashCount = 0;
let settings: AppSettings = loadSettings();
let isQuitting = false;
let benchmarkRunning = false;

// Software rendering: avoids blank/white windows on machines with flaky GPU
// drivers (common cause of "white screen" in Electron, incl. elevated runs).
app.disableHardwareAcceleration();

function logToFile(msg: string): void {
  try {
    const p = join(app.getPath("userData"), "error.log");
    appendFileSync(p, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* noop */
  }
}

process.on("uncaughtException", (e) => {
  logToFile("uncaught: " + String((e && e.stack) || e));
});

// app.isPackaged is false for any dev run (npx electron .), regardless of flags.
const isDev = !app.isPackaged;

function iconDataUrl(): string {
  // Orbit mark matching assets/icon.png (fallback when no file icon)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="15" fill="#101012"/><ellipse cx="32" cy="33" rx="19" ry="19" fill="none" stroke="#F5F5F4" stroke-width="3.4"/><path d="M35 19 L26.5 33 h4 L29 46 L38.5 30.5 h-4 z" fill="#F5F5F4"/><circle cx="44.7" cy="19.9" r="4.8" fill="#D71921"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function appIcon(): Electron.NativeImage {
  try {
    const fsPath = join(__dirname, "../../assets/icon.png");
    if (existsSync(fsPath)) {
      const img = nativeImage.createFromPath(fsPath);
      if (!img.isEmpty()) return img;
    }
  } catch {
    /* fall through */
  }
  return nativeImage.createFromDataURL(iconDataUrl());
}

function createWindow(): void {
  const pref = settings.theme ?? "system";
  let dark = pref === "dark";
  if (pref === "system") {
    try {
      dark = nativeTheme.shouldUseDarkColors;
    } catch {
      dark = false;
    }
  }
  mainWindow = new BrowserWindow({
    width: 1020,
    height: 720,
    minWidth: 880,
    minHeight: 620,
    title: "DNS Switcher",
    icon: appIcon(),
    autoHideMenuBar: true,
    show: false,
    backgroundColor: dark ? "#0a0a0a" : "#fafafa",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    logToFile(`did-fail-load ${code} ${desc} ${url}`);
    dialog.showErrorBox("DNS Switcher", `Failed to load UI (${desc}). Log: %APPDATA%/DNS Switcher/error.log`);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    logToFile("render-process-gone: " + JSON.stringify(details));
    crashCount += 1;
    if (crashCount > 3) {
      dialog.showErrorBox(
        "DNS Switcher",
        "The window keeps crashing. Please restart the app. Log: %APPDATA%/DNS Switcher/error.log"
      );
      return;
    }
    dialog.showErrorBox(
      "DNS Switcher",
      `The window process crashed (${details.reason}). The app will reload it. Log: %APPDATA%/DNS Switcher/error.log`
    );
    try {
      mainWindow?.webContents.reload();
    } catch {
      /* noop */
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (settings.startMinimized) {
      mainWindow?.hide();
    } else {
      mainWindow?.show();
    }
  });

  // Collapse to tray like Cloudflare WARP instead of quitting
  mainWindow.on("close", (e) => {
    if (!isQuitting && settings.minimizeToTray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("minimize", () => {
    if (settings.minimizeToTray) mainWindow?.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function toggleWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) mainWindow.hide();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function buildTrayMenu(activeLabel: string): void {
  const providerItems = DNS_PROVIDERS.slice(0, 8).map((p) => ({
    label: `${p.name} (${p.primary})`,
    type: "normal" as const,
    click: () => void applyProviderFromTray(p.id),
  }));
  providerItems.unshift({
    label: "Automatic (DHCP)",
    type: "normal" as const,
    click: () => void applyProviderFromTray("auto"),
  });
  const menu = Menu.buildFromTemplate([
    { label: activeLabel, enabled: false },
    { type: "separator" },
    {
      label: "Open DNS Switcher",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: "Benchmark fastest DNS",
      click: () => void benchmarkAndApplyBest(),
    },
    { type: "separator" },
    { label: "Quick switch", submenu: providerItems },
    { type: "separator" },
    {
      label: "Flush DNS cache",
      click: () => {
        flushDns()
          .then(() => notify("DNS cache flushed", "DNS Switcher", "ok"))
          .catch((e) => notify("Flush failed: " + String((e as Error).message), "DNS Switcher", "error"));
      },
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray?.setContextMenu(menu);
}

function setupTray(): void {
  const img = appIcon();
  // Tray on Windows wants ~16px; resize keeps it crisp
  const trayIcon = img.isEmpty() ? img : img.resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip("DNS Switcher");
  buildTrayMenu("DNS Switcher");
  tray.on("click", () => toggleWindow());
  // Right-click shows context menu automatically on Windows
}

/* ---------- minimal overlay toasts (no system notifications) ---------- */
let notifyWindow: BrowserWindow | null = null;
let notifyTimer: NodeJS.Timeout | null = null;
let notifyLoaded = false;
let pendingOverlay: { title: string; body: string; kind: "" | "ok" | "error" } | null = null;
const notifyQueue: { title: string; body: string; kind: "" | "ok" | "error" }[] = [];
const NOTIFY_MS = 3800;

function ensureNotifyWindow(): BrowserWindow {
  if (notifyWindow && !notifyWindow.isDestroyed()) return notifyWindow;
  const { workArea } = screen.getPrimaryDisplay();
  const W = 350;
  const H = 100;
  notifyLoaded = false;
  pendingOverlay = null;
  const w = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(workArea.x + workArea.width - W - 16),
    y: Math.round(workArea.y + workArea.height - H - 16),
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  w.setAlwaysOnTop(true, "screen-saver");
  w.loadFile(join(__dirname, "../renderer/notify.html"));
  w.webContents.on("did-finish-load", () => {
    notifyLoaded = true;
    if (pendingOverlay) {
      deliverOverlay(w, pendingOverlay);
      pendingOverlay = null;
    }
  });
  notifyWindow = w;
  return w;
}

/** Effective theme for the overlay: app setting, resolved against the OS. */
function overlayTheme(): "light" | "dark" {
  const pref = settings.theme ?? "system";
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  try {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  } catch {
    return "light";
  }
}

function deliverOverlay(
  w: BrowserWindow,
  item: { title: string; body: string; kind: "" | "ok" | "error" }
): void {
  try {
    w.webContents.send("notify:show", { ...item, ms: NOTIFY_MS, theme: overlayTheme() });
  } catch {
    /* noop */
  }
}

function hideOverlay(): void {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  try {
    notifyWindow?.hide();
  } catch {
    /* noop */
  }
}

function pumpNotifyQueue(): void {
  if (notifyTimer || notifyQueue.length === 0) return;
  const next = notifyQueue.shift();
  if (!next) return;
  try {
    const w = ensureNotifyWindow();
    if (notifyLoaded) deliverOverlay(w, next);
    else pendingOverlay = next;
    w.showInactive();
    // Fade-out first (renderer animates .leaving), then hide and continue.
    notifyTimer = setTimeout(() => {
      try {
        w.webContents.send("notify:hide");
      } catch {
        /* noop */
      }
      notifyTimer = setTimeout(() => {
        notifyTimer = null;
        try {
          w.hide();
        } catch {
          /* noop */
        }
        pumpNotifyQueue();
      }, 280);
    }, NOTIFY_MS);
  } catch (e) {
    logToFile("overlay failed: " + String((e as Error).message ?? e));
  }
}

/**
 * Route a message: in-app toast when the window is open, minimal overlay
 * popup (topmost, over any app) when collapsed to tray. Never touches the
 * Windows notification center.
 */
function notify(body: string, title = "DNS Switcher", kind: "" | "ok" | "error" = ""): void {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.webContents.send("app:toast", { msg: body, kind });
      return;
    }
  } catch {
    /* fall through to overlay */
  }
  notifyQueue.push({ title, body, kind });
  if (notifyQueue.length > 3) notifyQueue.shift();
  pumpNotifyQueue();
}

/** Brand id → primary/secondary lookup used for "current provider" matching. */
const KNOWN = DNS_PROVIDERS.map((p) => ({ id: p.id, primary: p.primary, secondary: p.secondary }));

async function currentAdapterAlias(): Promise<string> {
  if (settings.selectedAdapter) return settings.selectedAdapter;
  const adapters = await getAdapters();
  return adapters[0]?.name ?? "";
}

/** Persist + announce a DNS change made from anywhere (tray or window). */
function afterApply(alias: string, providerId: string, label: string): void {
  settings.selectedAdapter = alias;
  settings.lastProviderByAdapter[alias] = providerId;
  saveSettings(settings);
  notify(`DNS → ${label} on ${alias}`, "DNS Switcher", "ok");
  buildTrayMenu(`Active: ${label} · ${alias}`);
  mainWindow?.webContents.send("dns:changed", { adapter: alias, providerId });
}

async function applyProviderFromTray(providerId: string): Promise<void> {
  try {
    const alias = await currentAdapterAlias();
    if (!alias) return notify("No active network adapter found.", "DNS Switcher", "error");
    if (providerId === "auto") {
      await setAdapterDns(alias, []);
      afterApply(alias, "auto", "Automatic (DHCP)");
      return;
    }
    const p = getProvider(providerId);
    if (!p) return;
    await setAdapterDns(alias, [p.primary, p.secondary]);
    afterApply(alias, providerId, `${p.name} (${p.primary}, ${p.secondary})`);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ELEVATION_REQUIRED") {
      const r = await dialog.showMessageBox({
        type: "warning",
        title: "Administrator required",
        message: "Changing DNS requires administrator privileges.",
        detail: "Relaunch DNS Switcher as administrator?",
        buttons: ["Relaunch as admin", "Cancel"],
        defaultId: 0,
      });
      if (r.response === 0) {
        mainWindow?.hide();
        notify("Restarting as administrator…");
        if (relaunchAsAdmin()) {
          isQuitting = true;
          app.quit();
        } else {
          mainWindow?.show();
          notify("Still running without admin rights.");
        }
      }
    } else {
      notify("Failed: " + String((e as Error).message));
    }
  }
}

async function benchmarkAndApplyBest(): Promise<void> {
  if (benchmarkRunning) return;
  benchmarkRunning = true;
  try {
    notify("Benchmarking DNS providers…");
    mainWindow?.webContents.send("benchmark:progress", { done: 0, total: DNS_PROVIDERS.length, label: "starting" });
    const results = await benchmarkAll(KNOWN, (done, total, label) =>
      mainWindow?.webContents.send("benchmark:progress", { done, total, label })
    );
    const best = results.find((r) => r.scoreMs != null);
    if (!best) {
      notify("Benchmark failed — no DNS server reachable.", "DNS Switcher", "error");
      return;
    }
    const alias = await currentAdapterAlias();
    if (!alias) {
      notify("No active network adapter found.");
      return;
    }
    const p = getProvider(best.providerId);
    await setAdapterDns(alias, [best.primary, best.secondary]);
    settings.lastProviderByAdapter[alias] = best.providerId;
    saveSettings(settings);
    notify(`Fastest: ${p?.name ?? best.providerId} (${best.scoreMs} ms) applied on ${alias}`, "DNS Switcher", "ok");
    buildTrayMenu(`Active: ${p?.name ?? best.providerId} · ${alias}`);
    mainWindow?.webContents.send("dns:changed", { adapter: alias, providerId: best.providerId });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ELEVATION_REQUIRED") notify("Admin rights required to apply the fastest DNS.", "DNS Switcher", "error");
    else notify("Benchmark failed: " + String((e as Error).message), "DNS Switcher", "error");
  } finally {
    benchmarkRunning = false;
  }
}

/**
 * Relaunch the app elevated via UAC. Returns true when the elevated instance
 * was dispatched (caller must quit), false when the user denied UAC.
 *
 * Fully synchronous: the elevation request is issued while this process is
 * still alive, so nothing can silently die with us. The single-instance lock
 * is released first so the new instance doesn't mistake us for a duplicate;
 * on denial we take the lock back and keep running unelevated.
 */
function relaunchAsAdmin(): boolean {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  // ArgumentList items must carry embedded DOUBLE quotes: Start-Process
  // re-splits a plain string on spaces, truncating paths like "Dns Switcher".
  const qa = (s: string) => `'"${s.replace(/"/g, "")}"'`;
  const exe = process.execPath;
  // In dev, execPath is electron.exe and it needs the app folder as argument.
  // In the packaged app the exe needs no arguments.
  const parts = [`Start-Process -FilePath ${q(exe)}`];
  if (isDev) {
    parts.push(`-ArgumentList ${qa(app.getAppPath())}`);
    parts.push(`-WorkingDirectory ${q(app.getAppPath())}`);
  }
  parts.push("-Verb RunAs");
  logToFile(`elevate: start (dev=${isDev})`);
  try {
    app.releaseSingleInstanceLock();
  } catch {
    /* noop */
  }
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", parts.join(" ")], {
      windowsHide: true,
      timeout: 120000,
      stdio: "ignore",
    });
  } catch (e) {
    // Denied or failed — reclaim the lock and stay running without admin.
    logToFile("elevate: denied/failed: " + String((e as Error).message ?? e).slice(0, 300));
    try {
      app.requestSingleInstanceLock();
    } catch {
      /* noop */
    }
    return false;
  }
  logToFile("elevate: dispatched, quitting stub");
  return true;
}

/** Silent elevated autostart via Task Scheduler (no UAC prompt at logon).
 *  Creating a HIGHEST-privilege task requires admin — call only when elevated.
 *  Returns true on success. */
function setStartupTask(enable: boolean): boolean {
  const base = { windowsHide: true, timeout: 25000, stdio: "ignore" } as const;
  try {
    if (enable) {
      execFileSync(
        "schtasks.exe",
        ["/create", "/tn", "DNS Switcher", "/tr", `"${process.execPath}"`, "/sc", "ONLOGON", "/rl", "HIGHEST", "/f"],
        base
      );
    } else {
      try {
        execFileSync("schtasks.exe", ["/delete", "/tn", "DNS Switcher", "/f"], base);
      } catch {
        /* task may not exist */
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Registry Run-key autostart (used when the silent task is unavailable). */
function setRunAtLogin(open: boolean): void {
  try {
    app.setLoginItemSettings(open ? { openAtLogin: true, name: "DNS Switcher" } : { openAtLogin: false });
  } catch {
    /* noop */
  }
}

function registerIpc(): void {
  ipcMain.handle("app:getState", async () => {
    const [adapters, allDns, admin] = await Promise.all([
      getAdapters().catch(() => []),
      getAllDns().catch(() => []),
      isAdmin().catch(() => false),
    ]);
    let alias = settings.selectedAdapter;
    if (!alias || !adapters.some((a) => a.name === alias)) alias = adapters[0]?.name ?? "";
    const entry = allDns.find((d) => d.alias === alias);
    const servers = entry?.ipv4Servers ?? [];
    // Source of truth: registry-backed static-vs-DHCP check. A DHCP-provided
    // (e.g. router) address must read as "auto", never "custom".
    const dnsSource = alias ? await getDnsSource(alias).catch(() => "dhcp" as const) : "dhcp";
    return {
      settings,
      adapters,
      allDns,
      selectedAdapter: alias,
      currentServers: servers,
      dnsSource,
      currentProviderId:
        dnsSource === "dhcp"
          ? "auto"
          : matchProviderId(servers, KNOWN),
      providers: DNS_PROVIDERS,
      isAdmin: admin,
    };
  });

  ipcMain.handle("dns:apply", async (_e, args: { adapter: string; providerId: string; primary?: string; secondary?: string }) => {
    const p = getProvider(args.providerId);
    let servers: string[];
    let label: string;
    if (args.providerId === "auto") {
      servers = [];
      label = "Automatic (DHCP)";
    } else if (args.providerId === "custom") {
      servers = [args.primary ?? "", args.secondary ?? ""].map((s) => s.trim()).filter(Boolean);
      if (!servers.length) throw new Error("Enter at least one custom DNS IP.");
      label = `Custom (${servers.join(", ")})`;
    } else {
      if (!p) throw new Error("Unknown provider.");
      servers = [p.primary, p.secondary];
      label = p.name;
    }
    await setAdapterDns(args.adapter, servers);
    settings.selectedAdapter = args.adapter;
    settings.lastProviderByAdapter[args.adapter] = args.providerId;
    if (args.providerId === "custom") {
      settings.customDns = { primary: servers[0] ?? "", secondary: servers[1] ?? "" };
    }
    saveSettings(settings);
    buildTrayMenu(`Active: ${label} · ${args.adapter}`);
    notify(`DNS → ${label} on ${args.adapter}`, "DNS Switcher", "ok");
    return { ok: true };
  });

  ipcMain.handle("dns:flush", async () => {
    await flushDns();
    return { ok: true };
  });

  ipcMain.handle("dns:ping", async (_e, ip: string) => pingHost(ip));

  ipcMain.handle("dns:benchmarkOne", async (_e, providerId: string) => {
    const p = getProvider(providerId);
    if (!p) throw new Error("Unknown provider.");
    return benchmarkProvider(p.id, p.primary, p.secondary);
  });

  ipcMain.handle("dns:benchmarkAll", async () => {
    if (benchmarkRunning) throw new Error("Benchmark already running.");
    benchmarkRunning = true;
    try {
      const results = await benchmarkAll(KNOWN, (done, total, label) =>
        mainWindow?.webContents.send("benchmark:progress", { done, total, label })
      );
      return results;
    } finally {
      benchmarkRunning = false;
    }
  });

  ipcMain.handle("dns:applyBest", async (_e, results: { providerId: string; primary: string; secondary: string }[]) => {
    const alias = settings.selectedAdapter || (await currentAdapterAlias());
    const best = results[0];
    if (!best) throw new Error("No results.");
    await setAdapterDns(alias, [best.primary, best.secondary]);
    settings.lastProviderByAdapter[alias] = best.providerId;
    saveSettings(settings);
    buildTrayMenu(`Active: ${getProvider(best.providerId)?.name} · ${alias}`);
    return { ok: true, adapter: alias, providerId: best.providerId };
  });

  ipcMain.handle("settings:update", async (_e, patch: Partial<AppSettings>) => {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    if (typeof patch.launchAtStartup === "boolean") {
      const admin = await isAdmin().catch(() => false);
      if (patch.launchAtStartup && admin) {
        // Elevated silent autostart (no UAC at logon), else registry Run key.
        if (setStartupTask(true)) setRunAtLogin(false);
        else setRunAtLogin(true);
      } else {
        setStartupTask(false);
        setRunAtLogin(patch.launchAtStartup);
      }
    }
    return settings;
  });

  ipcMain.handle("app:relaunchAdmin", async () => {
    mainWindow?.hide();
    notify("Restarting as administrator…");
    if (relaunchAsAdmin()) {
      isQuitting = true;
      app.quit();
      return { ok: true, elevated: true };
    }
    mainWindow?.show();
    notify("Still running without admin rights.");
    return { ok: true, elevated: false };
  });

  ipcMain.handle("app:quit", () => {
    isQuitting = true;
    hideOverlay();
    app.quit();
    return { ok: true };
  });

  ipcMain.on("notify:click", () => {
    hideOverlay();
    if (!mainWindow) createWindow();
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// Single instance like WARP — second launch just shows the window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    settings = loadSettings();
    logToFile(`boot: ready (dev=${isDev} args=${JSON.stringify(process.argv.slice(1))})`);
    if (settings.autoElevate === undefined) {
      settings.autoElevate = true;
      saveSettings(settings);
    }
    // Always run elevated: if started without admin rights, immediately
    // relaunch elevated (UAC prompt) and exit this instance so the single-
    // instance lock is free. Skip in dev and with --no-elevate (recovery).
    const noElevate = process.argv.includes("--no-elevate");
    // Auto-elevate applies to packaged AND dev runs alike (dev previously
    // skipped it, which is why "start as admin" never triggered in previews).
    // Pass --no-elevate to force a plain start.
    if (!noElevate && settings.autoElevate) {
      const admin = await isAdmin().catch(() => false);
      logToFile(`boot: admin=${admin} autoElevate=${settings.autoElevate}`);
      if (!admin) {
        // relaunchAsAdmin releases the lock synchronously; on denial it
        // re-locks and returns false, and we just start normally.
        if (relaunchAsAdmin()) {
          isQuitting = true;
          app.quit();
          return;
        }
        notify("Starting without admin rights (UAC denied).");
      }
    }
    try {
      // Prefer the silent elevated task when already admin; otherwise the
      // plain registry Run entry (which will UAC-prompt via auto-elevate).
      const admin = await isAdmin().catch(() => false);
      if (settings.launchAtStartup && admin) setStartupTask(true);
      else setRunAtLogin(!!settings.launchAtStartup);
    } catch {
      /* noop */
    }
    registerIpc();
    logToFile("boot: ipc registered");
    createWindow();
    logToFile("boot: window created");
    setupTray();
    logToFile("boot: tray ready");
  });

  app.on("window-all-closed", () => {
    // Keep running in tray (WARP behavior); quit only via tray menu
  });

  app.on("before-quit", () => {
    try {
      if (notifyTimer) clearTimeout(notifyTimer);
      notifyTimer = null;
      notifyWindow?.hide();
    } catch {
      /* noop */
    }
  });

  app.on("activate", () => {
    mainWindow?.show();
  });
}
