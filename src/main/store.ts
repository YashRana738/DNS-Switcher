import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export interface AppSettings {
  selectedAdapter: string;
  minimizeToTray: boolean;
  startMinimized: boolean;
  launchAtStartup: boolean;
  autoElevate: boolean;
  theme: "system" | "light" | "dark";
  lastProviderByAdapter: Record<string, string>;
  customDns: { primary: string; secondary: string };
}

const DEFAULTS: AppSettings = {
  selectedAdapter: "",
  minimizeToTray: true,
  startMinimized: false,
  launchAtStartup: false,
  autoElevate: true,
  theme: "system",
  lastProviderByAdapter: {},
  customDns: { primary: "", secondary: "" },
};

function filePath(): string {
  try {
    return join(app.getPath("userData"), "settings.json");
  } catch {
    return join(process.cwd(), "settings.json");
  }
}

export function loadSettings(): AppSettings {
  try {
    const p = filePath();
    if (!existsSync(p)) return { ...DEFAULTS };
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULTS,
      ...parsed,
      customDns: { ...DEFAULTS.customDns, ...(parsed.customDns ?? {}) },
      lastProviderByAdapter: { ...(parsed.lastProviderByAdapter ?? {}) },
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: AppSettings): void {
  try {
    const p = filePath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(s, null, 2), "utf8");
  } catch {
    /* ignore */
  }
}
