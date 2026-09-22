/* Renderer — WinUI-style DNS Switcher UI (plain script, no modules) */

interface DnsProvider {
  id: string;
  name: string;
  description: string;
  primary: string;
  secondary: string;
  color: string;
  icon: string;
  doh?: string;
}

interface NetAdapter {
  name: string;
  description: string;
}

interface AdapterDns {
  alias: string;
  ipv4Servers: string[];
}

interface AppState {
  settings: {
    selectedAdapter: string;
    minimizeToTray: boolean;
    startMinimized: boolean;
    launchAtStartup: boolean;
    autoElevate: boolean;
    theme: "system" | "light" | "dark";
    lastProviderByAdapter: Record<string, string>;
    customDns: { primary: string; secondary: string };
  };
  adapters: NetAdapter[];
  allDns: AdapterDns[];
  selectedAdapter: string;
  currentServers: string[];
  currentProviderId: string;
  providers: DnsProvider[];
  isAdmin: boolean;
}

interface ProviderResult {
  providerId: string;
  primary: string;
  secondary: string;
  primaryPing: { ip: string; ok: boolean; avgMs: number | null };
  secondaryPing: { ip: string; ok: boolean; avgMs: number | null };
  bestAvgMs: number | null;
  dnsQueryMs: number | null;
  scoreMs: number | null;
}

interface Window {
  dnsApi: {
      getState(): Promise<AppState>;
      apply(args: { adapter: string; providerId: string; primary?: string; secondary?: string }): Promise<{ ok: boolean }>;
      flush(): Promise<{ ok: boolean }>;
      ping(ip: string): Promise<{ ip: string; ok: boolean; avgMs: number | null; dnsMs?: number | null; error?: string }>;
      benchmarkOne(providerId: string): Promise<ProviderResult>;
      benchmarkAll(): Promise<ProviderResult[]>;
      applyBest(results: ProviderResult[]): Promise<{ ok: boolean; adapter: string; providerId: string }>;
      updateSettings(patch: Record<string, unknown>): Promise<unknown>;
      relaunchAdmin(): Promise<{ ok: boolean; elevated: boolean }>;
      quit(): Promise<unknown>;
      onBenchmarkProgress(cb: (p: { done: number; total: number; label: string }) => void): () => void;
      onDnsChanged(cb: (v: { adapter: string; providerId: string }) => void): () => void;
      onToast(cb: (v: { msg: string; kind: string }) => void): () => void;
  };
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};
const input = (id: string): HTMLInputElement => $<HTMLInputElement>(id);

let state: AppState | null = null;
let resultsById = new Map<string, ProviderResult>();
let lastResults: ProviderResult[] = [];
let busy = false;
let selectedAdapter = "";

function toast(msg: string, kind: "ok" | "error" | "" = ""): void {
  const box = $("toasts");
  const div = document.createElement("div");
  div.className = `toast ${kind}`;
  div.textContent = msg;
  box.appendChild(div);
  setTimeout(() => {
    div.style.opacity = "0";
    div.style.transition = "opacity .3s";
    setTimeout(() => div.remove(), 320);
  }, 3400);
}

function setOverlay(show: boolean, text = "Working…"): void {
  $("overlay").classList.toggle("hidden", !show);
  $("overlayText").textContent = text;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function pingClass(ms: number | null): string {
  if (ms == null) return "";
  if (ms < 40) return "good";
  if (ms < 120) return "mid";
  return "bad";
}

function pingText(ms: number | null): string {
  return ms == null ? "—" : `${ms} ms`;
}

function initials(name: string): string {
  return name.split(/[\s()]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function providerLabel(id: string): string {
  if (id === "auto") return "Automatic (DHCP)";
  if (id === "custom") return "Custom DNS";
  return state?.providers.find((p) => p.id === id)?.name ?? id;
}

function applyTheme(): void {
  const pref = state?.settings.theme ?? "system";
  let dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (pref === "light") dark = false;
  if (pref === "dark") dark = true;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  syncThemeUI(pref);
}

function syncThemeUI(pref: string): void {
  $("themeSystem").classList.toggle("active", pref === "system");
  $("themeLight").classList.toggle("active", pref === "light");
  $("themeDark").classList.toggle("active", pref === "dark");
}

async function setTheme(next: "system" | "light" | "dark"): Promise<void> {
  try {
    await window.dnsApi.updateSettings({ theme: next });
    if (state) state.settings.theme = next;
  } catch {
    /* noop */
  }
  applyTheme();
}

function showView(which: "main" | "settings"): void {
  $("viewMain").classList.toggle("hidden", which !== "main");
  $("viewSettings").classList.toggle("hidden", which !== "settings");
  $("navMain").classList.toggle("active", which === "main");
  $("navSettings").classList.toggle("active", which === "settings");
}

async function refresh(silent = false): Promise<void> {
  if (!silent) setOverlay(true, "Reading adapters…");
  try {
    state = await window.dnsApi.getState();
    applyTheme();
    renderAll();
  } catch (e) {
    toast("Failed to load state: " + String((e as Error).message), "error");
  } finally {
    if (!silent) setOverlay(false);
  }
}

function renderAll(): void {
  if (!state) return;
  // admin bar
  $("adminBar").classList.toggle("hidden", state.isAdmin);
  // adapters → custom WinUI dropdown
  selectedAdapter = state.selectedAdapter;
  $("adapterLabel").textContent = selectedAdapter || "No adapter";
  const menu = $("adapterMenu");
  menu.innerHTML = "";
  if (!state.adapters.length) {
    const d = document.createElement("div");
    d.className = "combo-empty muted";
    d.textContent = "No adapters found";
    menu.appendChild(d);
  }
  for (const a of state.adapters) {
    const b = document.createElement("button");
    b.className = "combo-item";
    b.setAttribute("role", "option");
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.textContent = a.name === selectedAdapter ? "✓" : "";
    const tx = document.createElement("span");
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = a.name;
    const ds = document.createElement("span");
    ds.className = "ds";
    ds.textContent = ` — ${a.description.slice(0, 44)}`;
    tx.appendChild(nm);
    tx.appendChild(ds);
    b.appendChild(tick);
    b.appendChild(tx);
    b.addEventListener("click", () => void pickAdapter(a.name));
    menu.appendChild(b);
  }
  // status
  const servers = state.currentServers;
  const [p1 = "", p2 = ""] = servers;
  $("curPrimary").textContent = p1 || "Automatic";
  $("curSecondary").textContent = p2 || "—";
  const pid = state.currentProviderId;
  const dot = $("statusDot");
  if (pid === "auto") {
    dot.className = "status-dot off";
    $("statusName").textContent = "Automatic (DHCP)";
    $("statusDetail").textContent = `${state.selectedAdapter || "—"} · DNS from router`;
    input("enableToggle").checked = false;
  } else {
    dot.className = "status-dot on";
    $("statusName").textContent = providerLabel(pid);
    $("statusDetail").textContent = `${state.selectedAdapter || "—"} · ${servers.join(" · ") || "custom"}`;
    input("enableToggle").checked = true;
  }
  $("subtitle").textContent = `${state.selectedAdapter || "No adapter"} · ${servers.length ? servers.join(", ") : "DHCP"}`;
  // custom inputs
  input("customPrimary").value = state.settings.customDns.primary ?? "";
  input("customSecondary").value = state.settings.customDns.secondary ?? "";
  // settings checkboxes
  input("optTray").checked = !!state.settings.minimizeToTray;
  input("optMinimized").checked = !!state.settings.startMinimized;
  input("optStartup").checked = !!state.settings.launchAtStartup;
  input("optAdmin").checked = state.settings.autoElevate !== false;
  renderProviders();
}

function renderProviders(filter = ""): void {
  if (!state) return;
  const list = $("providerList");
  const q = filter.trim().toLowerCase();
  const current = state.currentProviderId;
  const bestId = lastResults.length && lastResults[0].scoreMs != null ? lastResults[0].providerId : "";
  const items = state.providers.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.primary.includes(q) || p.description.toLowerCase().includes(q)
  );
  $("provCount").textContent = `· ${items.length} shown`;
  list.innerHTML = "";
  // Automatic pseudo-row first when no filter
  if (!q) {
    const auto = document.createElement("div");
    auto.className = `prov${current === "auto" ? " active" : ""}`;
    auto.innerHTML = `
      <div class="avatar" style="background:#525252"><span class="auto-glyph"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></span></div>
      <div class="prov-info">
        <div class="prov-name">Automatic (DHCP) ${current === "auto" ? "✓" : ""}</div>
        <div class="prov-desc">Use router-provided DNS</div>
        <div class="prov-ips">DHCP</div>
      </div>
      <div class="prov-actions"><button class="mini-btn use" data-act="auto">Use</button></div>`;
    auto.querySelector("[data-act='auto']")?.addEventListener("click", () => void applyProvider("auto"));
    list.appendChild(auto);
  }
  for (const p of items) {
    const r = resultsById.get(p.id);
    const ms = r?.scoreMs ?? r?.bestAvgMs ?? null;
    const div = document.createElement("div");
    div.className = `prov${current === p.id ? " active" : ""}${bestId === p.id ? " fastest" : ""}`;
    div.innerHTML = `
      <div class="avatar" style="background:${esc(p.color)}"><img class="prov-icon" src="../assets/providers/${esc(p.icon)}" alt="" loading="lazy" />${esc(initials(p.name))}</div>
      <div class="prov-info">
        <div class="prov-name">${esc(p.name)} ${current === p.id ? "✓" : ""} ${bestId === p.id ? '<span class="crown" title="Fastest in last benchmark">★</span>' : ""}</div>
        <div class="prov-desc">${esc(p.description)}</div>
        <div class="prov-ips">${esc(p.primary)} · ${esc(p.secondary)}</div>
      </div>
      <span class="ping ${pingClass(ms)}" title="${r ? `ping ${r.bestAvgMs ?? "—"} ms · dns ${r.dnsQueryMs ?? "—"} ms` : "not tested yet"}">${r ? pingText(r.bestAvgMs) : "—"}</span>
      <div class="prov-actions">
        <button class="mini-btn" data-act="ping" title="Ping ${esc(p.primary)}">Ping</button>
        <button class="mini-btn use" data-act="use">Use</button>
      </div>`;
    div.querySelector("[data-act='use']")?.addEventListener("click", () => void applyProvider(p.id));
    div.querySelector("[data-act='ping']")?.addEventListener("click", (ev) => void pingRow(p.id, ev.target as HTMLElement));
    // If the logo file is missing, drop the <img> so the initial-letter fallback shows.
    div.querySelectorAll(".prov-icon").forEach((img) => {
      img.addEventListener("error", () => img.remove());
    });
    list.appendChild(div);
  }
  if (!items.length && q) {
    list.innerHTML = `<div class="muted">No providers match “${esc(filter)}”.</div>`;
  }
}

function currentAdapter(): string {
  return selectedAdapter || state?.selectedAdapter || "";
}

async function pickAdapter(name: string): Promise<void> {
  $("adapterMenu").classList.add("hidden");
  if (!name || name === selectedAdapter) return;
  selectedAdapter = name;
  $("adapterLabel").textContent = name;
  try {
    await window.dnsApi.updateSettings({ selectedAdapter: name });
    if (state) {
      state.settings.selectedAdapter = name;
      state.selectedAdapter = name;
    }
  } catch { /* noop */ }
  await refresh(true);
}

async function applyProvider(providerId: string, primary?: string, secondary?: string): Promise<void> {
  const adapter = currentAdapter();
  if (!adapter) return toast("No network adapter selected.", "error");
  if (busy) return;
  busy = true;
  setOverlay(true, `Applying ${providerLabel(providerId)}…`);
  try {
    await window.dnsApi.apply({ adapter, providerId, primary, secondary });
    toast(`DNS → ${providerLabel(providerId)} on ${adapter}`, "ok");
    await refresh(true);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/Administrator/i.test(msg)) toast("Administrator rights required — use “Relaunch as admin”.", "error");
    else toast("Apply failed: " + msg, "error");
  } finally {
    busy = false;
    setOverlay(false);
  }
}

async function pingRow(providerId: string, btn: HTMLElement): Promise<void> {
  const p = state?.providers.find((x) => x.id === providerId);
  if (!p) return;
  const badge = btn.closest(".prov")?.querySelector(".ping");
  btn.textContent = "…";
  (btn as HTMLButtonElement).disabled = true;
  try {
    const res = await window.dnsApi.benchmarkOne(providerId);
    resultsById.set(providerId, res);
    if (badge) {
      badge.className = `ping ${pingClass(res.bestAvgMs)}`;
      badge.textContent = pingText(res.bestAvgMs);
      badge.setAttribute("title", `ping ${res.bestAvgMs ?? "—"} ms · dns ${res.dnsQueryMs ?? "—"} ms`);
    }
  } catch (e) {
    toast(`Ping failed for ${p.name}`, "error");
  } finally {
    btn.textContent = "Ping";
    (btn as HTMLButtonElement).disabled = false;
  }
}

async function benchmarkAll(): Promise<void> {
  if (busy) return;
  busy = true;
  $("benchBtn").textContent = "Testing…";
  $<HTMLButtonElement>("benchBtn").disabled = true;
  $("benchProgress").classList.remove("hidden");
  try {
    const results = await window.dnsApi.benchmarkAll();
    lastResults = results;
    resultsById = new Map(results.map((r) => [r.providerId, r]));
    renderTopList();
    const best = results.find((r) => r.scoreMs != null);
    if (best) {
      toast(`Fastest: ${providerLabel(best.providerId)} (${best.scoreMs} ms)`, "ok");
    } else {
      toast("No DNS server reachable — check connection.", "error");
    }
    renderProviders(input("search").value);
  } catch (e) {
    toast("Benchmark failed: " + String((e as Error).message), "error");
  } finally {
    busy = false;
    $("benchBtn").textContent = "Benchmark";
    $<HTMLButtonElement>("benchBtn").disabled = false;
    $("benchProgress").classList.add("hidden");
  }
}

function renderTopList(): void {
  const box = $("topList");
  box.innerHTML = "";
  const ranked = lastResults.filter((r) => r.scoreMs != null).slice(0, 3);
  if (!ranked.length) {
    box.classList.add("hidden");
    $("benchEmpty").classList.remove("hidden");
    return;
  }
  $("benchEmpty").classList.add("hidden");
  box.classList.remove("hidden");
  ranked.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "top-row" + (i === 0 ? " first" : "");
    const rank = document.createElement("span");
    rank.className = "top-rank";
    rank.textContent = String(i + 1);
    const nm = document.createElement("span");
    nm.className = "top-name";
    nm.textContent = providerLabel(r.providerId);
    const ms = document.createElement("span");
    ms.className = "top-ms";
    ms.textContent = `${r.scoreMs} ms`;
    row.appendChild(rank);
    row.appendChild(nm);
    row.appendChild(ms);
    if (i === 0) {
      const btn = document.createElement("button");
      btn.className = "button primary small";
      btn.textContent = "Apply";
      btn.addEventListener("click", () => void applyBest());
      row.appendChild(btn);
    }
    box.appendChild(row);
  });
}

async function applyBest(): Promise<void> {
  if (!lastResults.length) return;
  setOverlay(true, "Applying fastest DNS…");
  try {
    const res = await window.dnsApi.applyBest(lastResults);
    toast(`Fastest DNS applied on ${res.adapter}`, "ok");
    await refresh(true);
  } catch (e) {
    toast("Apply failed: " + String((e as Error).message), "error");
  } finally {
    setOverlay(false);
  }
}

function wire(): void {
  $("adapterBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("adapterMenu").classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    const menu = $("adapterMenu");
    if (!menu.classList.contains("hidden") && !(e.target as HTMLElement).closest?.(".combo-wrap")) {
      menu.classList.add("hidden");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("adapterMenu").classList.add("hidden");
    if (e.key === "F5") {
      e.preventDefault();
      void refresh();
    }
  });
  $("search").addEventListener("input", (e) => renderProviders((e.target as HTMLInputElement).value));
  $("refreshBtn").addEventListener("click", () => void refresh());
  $("flushBtn").addEventListener("click", async () => {
    try {
      await window.dnsApi.flush();
      toast("DNS cache flushed.", "ok");
    } catch (e) {
      toast("Flush failed: " + String((e as Error).message), "error");
    }
  });
  $("autoBtn").addEventListener("click", () => void applyProvider("auto"));
  $("customBtn").addEventListener("click", () => {
    const a = input("customPrimary").value.trim();
    const b = input("customSecondary").value.trim();
    if (!a && !b) return toast("Enter at least one DNS IP.", "error");
    const ip = /^\d{1,3}(\.\d{1,3}){3}$/;
    if ((a && !ip.test(a)) || (b && !ip.test(b))) return toast("Invalid IPv4 address.", "error");
    void applyProvider("custom", a, b);
  });
  $("benchBtn").addEventListener("click", () => void benchmarkAll());
  $("enableToggle").addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    if (!on) void applyProvider("auto");
    else {
      const last = state?.settings.lastProviderByAdapter?.[currentAdapter()];
      const fallback = last && last !== "auto" ? last : "cloudflare";
      if (fallback === "custom") {
        void applyProvider("custom", state?.settings.customDns.primary, state?.settings.customDns.secondary);
      } else {
        void applyProvider(fallback);
      }
    }
  });
  $("adminBtn").addEventListener("click", async () => {
    toast("Restarting as administrator — accept the UAC prompt…");
    try {
      const r = await window.dnsApi.relaunchAdmin();
      if (!r.elevated) toast("Still running without admin rights.", "error");
    } catch (e) {
      toast("Relaunch failed: " + String((e as Error).message), "error");
    }
  });
  $("themeBtn").addEventListener("click", async () => {
    const cur = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    await setTheme(cur === "dark" ? "light" : "dark");
  });
  $("themeSystem").addEventListener("click", () => void setTheme("system"));
  $("themeLight").addEventListener("click", () => void setTheme("light"));
  $("themeDark").addEventListener("click", () => void setTheme("dark"));
  $("navMain").addEventListener("click", () => showView("main"));
  $("navSettings").addEventListener("click", () => showView("settings"));
  $("quitBtn").addEventListener("click", () => void window.dnsApi.quit());

  const saveOpt = (key: string) => async (e: Event) => {
    const v = (e.target as HTMLInputElement).checked;
    try {
      await window.dnsApi.updateSettings({ [key]: v });
      if (state) (state.settings as unknown as Record<string, unknown>)[key] = v;
    } catch { /* noop */ }
  };
  $("optTray").addEventListener("change", saveOpt("minimizeToTray"));
  $("optMinimized").addEventListener("change", saveOpt("startMinimized"));
  $("optStartup").addEventListener("change", saveOpt("launchAtStartup"));
  $("optAdmin").addEventListener("change", saveOpt("autoElevate"));

  window.dnsApi.onBenchmarkProgress((p: { done: number; total: number; label: string }) => {
    $("benchProgress").classList.remove("hidden");
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    $("benchBar").style.width = `${pct}%`;
    $("benchLabel").textContent = `Testing ${p.done}/${p.total}… ${p.label}`;
  });
  window.dnsApi.onDnsChanged(() => void refresh(true));
  window.dnsApi.onToast((t) => toast(t.msg, t.kind === "error" ? "error" : t.kind === "ok" ? "ok" : ""));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme());
}

document.addEventListener("DOMContentLoaded", () => {
  wire();
  void refresh();
});
