import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface NetAdapter {
  name: string; // InterfaceAlias e.g. "Wi-Fi"
  description: string;
  status: string;
  linkSpeed?: string;
  ifIndex?: number;
}

export interface AdapterDns {
  alias: string;
  ifIndex?: number;
  ipv4Servers: string[];
  ipv6Servers: string[];
}

function runPowershell(script: string, timeout = 15000): Promise<string> {
  return execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    timeout,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  }).then((r) => (r.stdout ?? "").toString());
}

function escPs(s: string): string {
  return s.replace(/'/g, "''");
}

/** Are we elevated? `net session` only succeeds as admin. */
export async function isAdmin(): Promise<boolean> {
  try {
    await execFileAsync("net", ["session"], { windowsHide: true, timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

/** List physical + up adapters, fallback to all up adapters incl. virtual. */
export async function getAdapters(): Promise<NetAdapter[]> {
  const script = `
    $a = Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' };
    if (-not $a) { $a = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } }
    $a | Select-Object Name, InterfaceDescription, Status, LinkSpeed, ifIndex | ConvertTo-Json -Depth 3 -Compress
  `;
  try {
    const out = (await runPowershell(script)).trim();
    if (!out) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(out);
    } catch {
      return [];
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
      .map((x) => ({
        name: String(x["Name"] ?? ""),
        description: String(x["InterfaceDescription"] ?? ""),
        status: String(x["Status"] ?? ""),
        linkSpeed: x["LinkSpeed"] != null ? String(x["LinkSpeed"]) : undefined,
        ifIndex: typeof x["ifIndex"] === "number" ? x["ifIndex"] : undefined,
      }))
      .filter((a) => a.name.length > 0);
  } catch {
    return [];
  }
}

export async function getAllDns(): Promise<AdapterDns[]> {
  const script = `
    Get-DnsClientServerAddress -AddressFamily IPv4 |
      Select-Object InterfaceAlias, InterfaceIndex, ServerAddresses | ConvertTo-Json -Depth 4 -Compress
  `;
  try {
    const out = (await runPowershell(script)).trim();
    if (!out) return [];
    const parsed = JSON.parse(out) as
      | { InterfaceAlias: string; InterfaceIndex: number; ServerAddresses: string[] | string }
      | Array<{ InterfaceAlias: string; InterfaceIndex: number; ServerAddresses: string[] | string }>;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const v6 = await getAllDnsV6().catch(() => [] as { alias: string; servers: string[] }[]);
    const v6map = new Map(v6.map((x) => [x.alias.toLowerCase(), x.servers]));
    return arr.map((x) => {
      const raw = x.ServerAddresses;
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return {
        alias: String(x.InterfaceAlias ?? ""),
        ifIndex: Number(x.InterfaceIndex),
        ipv4Servers: list.filter(Boolean).map(String),
        ipv6Servers: v6map.get(String(x.InterfaceAlias ?? "").toLowerCase()) ?? [],
      };
    });
  } catch {
    return [];
  }
}

async function getAllDnsV6(): Promise<{ alias: string; servers: string[] }[]> {
  const script = `
    Get-DnsClientServerAddress -AddressFamily IPv6 |
      Select-Object InterfaceAlias, ServerAddresses | ConvertTo-Json -Depth 4 -Compress
  `;
  const out = (await runPowershell(script)).trim();
  if (!out) return [];
  const parsed = JSON.parse(out) as
    | { InterfaceAlias: string; ServerAddresses: string[] | string }
    | Array<{ InterfaceAlias: string; ServerAddresses: string[] | string }>;
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.map((x) => {
    const raw = x.ServerAddresses;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return { alias: String(x.InterfaceAlias ?? ""), servers: list.filter(Boolean).map(String) };
  });
}

export async function flushDns(): Promise<void> {
  await execFileAsync("ipconfig", ["/flushdns"], { windowsHide: true, timeout: 15000 });
}

/** Apply static IPv4 DNS to one adapter. Pass empty array to revert to DHCP/auto. */
export async function setAdapterDns(alias: string, servers: string[]): Promise<void> {
  if (!alias) throw new Error("No network adapter selected.");
  const clean = servers.map((s) => s.trim()).filter((s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s));
  if (servers.length > 0 && clean.length === 0) throw new Error("Invalid DNS IP address.");
  const admin = await isAdmin();
  if (!admin) {
    const e = new Error("Administrator privileges required to change DNS.");
    (e as NodeJS.ErrnoException).code = "ELEVATION_REQUIRED";
    throw e;
  }
  if (clean.length === 0) {
    // Revert to automatic (DHCP)
    const script = `Set-DnsClientServerAddress -InterfaceAlias '${escPs(alias)}' -ResetServerAddresses; ipconfig /flushdns | Out-Null`;
    await runPowershell(script, 25000);
    sourceCache.set(alias, { src: "dhcp", at: Date.now() });
    return;
  }
  const list = clean.map((s) => `'${escPs(s)}'`).join(",");
  const script = `Set-DnsClientServerAddress -InterfaceAlias '${escPs(alias)}' -ServerAddresses (${list}); ipconfig /flushdns | Out-Null`;
  try {
    await runPowershell(script, 25000);
  } catch (err: unknown) {
    // Retry once via netsh (interface names with special chars sometimes fail in PS provider)
    const primary = clean[0];
    await execFileAsync("netsh", ["interface", "ip", "set", "dns", `name=${alias}`, "static", primary], {
      windowsHide: true,
      timeout: 20000,
    });
    if (clean[1]) {
      await execFileAsync("netsh", ["interface", "ip", "add", "dns", `name=${alias}`, clean[1], "index=2"], {
        windowsHide: true,
        timeout: 20000,
      });
    }
    await flushDns().catch(() => undefined);
  }
  sourceCache.set(alias, { src: "static", at: Date.now() });
}

/** Definitive per-adapter DNS source: static NameServer present in registry? */
export type DnsSource = "dhcp" | "static";

// Registry reads spawn a process; cache briefly (invalidated on every apply).
const sourceCache = new Map<string, { src: DnsSource; at: number }>();

export async function getDnsSource(alias: string): Promise<DnsSource> {
  const hit = sourceCache.get(alias);
  if (hit && Date.now() - hit.at < 10000) return hit.src;
  const script = `
    $a = Get-NetAdapter | Where-Object { $_.Name -eq '${escPs(alias)}' } | Select-Object -First 1;
    if (-not $a) { 'unknown' } else {
      $p = "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\" + $a.InterfaceGuid;
      $v = (Get-ItemProperty -Path $p -Name NameServer -ErrorAction SilentlyContinue).NameServer;
      if ($v -and "$v".Trim().Length -gt 0) { 'static' } else { 'dhcp' }
    }
  `;
  try {
    const out = (await runPowershell(script, 10000)).trim().toLowerCase();
    const src: DnsSource = out.includes("static") ? "static" : "dhcp";
    sourceCache.set(alias, { src, at: Date.now() });
    return src;
  } catch {
    return hit?.src ?? "dhcp";
  }
}

/** Detect which known provider (if any) an adapter is currently using. */
export function matchProviderId(servers: string[], providers: { id: string; primary: string; secondary: string }[]): string {
  const set = new Set(servers.map((s) => s.trim()));
  if (set.size === 0) return "auto";
  for (const p of providers) {
    if (set.has(p.primary) || set.has(p.secondary)) return p.id;
  }
  return "custom";
}
