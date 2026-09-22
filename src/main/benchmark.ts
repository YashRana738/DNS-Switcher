import { execFile } from "child_process";
import { Resolver } from "dns/promises";

export interface PingSample {
  ip: string;
  ok: boolean;
  avgMs: number | null;
  minMs?: number | null;
  maxMs?: number | null;
  lossPct?: number | null;
  dnsMs?: number | null;
  error?: string;
}

export interface ProviderResult {
  providerId: string;
  primary: string;
  secondary: string;
  primaryPing: PingSample;
  secondaryPing: PingSample;
  /** best (min) avg of the two, for ranking */
  bestAvgMs: number | null;
  dnsQueryMs: number | null;
  scoreMs: number | null;
}

function pingOnce(ip: string, count = 4, timeoutMs = 6000): Promise<PingSample> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (s: PingSample) => {
      if (!settled) {
        settled = true;
        resolve(s);
      }
    };
    const child = execFile(
      "ping",
      ["-n", String(count), "-w", "1000", ip],
      { windowsHide: true, timeout: timeoutMs + 3000 },
      (error, stdout) => {
        const out = String(stdout ?? "");
        const sample: PingSample = { ip, ok: false, avgMs: null };
        try {
          const loss = out.match(/Lost\s*=\s*\d+\s*\((\d+)%\s*loss\)/i) || out.match(/\((\d+)%\s*(loss|perte|Verlust)\)/i);
          if (loss) sample.lossPct = Number(loss[1]);

          // Primary: per-reply "time=12ms" / "time<1ms" samples.
          // Drop the single highest sample — the first echo almost always
          // includes ARP/route-setup cost and skews the average on Wi-Fi.
          const times = [...out.matchAll(/time\s*(<|=)\s*(\d+)\s*ms/gi)].map((m) =>
            m[1] === "<" ? Math.min(Number(m[2]), 1) : Number(m[2])
          );
          if (times.length >= 2) {
            const sorted = [...times].sort((a, b) => a - b);
            sorted.pop(); // drop worst
            sample.avgMs = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
            sample.minMs = Math.min(...times);
            sample.maxMs = Math.max(...times);
            sample.ok = true;
          } else if (times.length === 1) {
            sample.avgMs = times[0];
            sample.minMs = times[0];
            sample.maxMs = times[0];
            sample.ok = true;
          } else {
            // Fallback: summary line (EN/DE/FR Windows locales)
            const minMax = out.match(/Minimum\s*=\s*(\d+)\s*ms.*?Maximum\s*=\s*(\d+)\s*ms.*?Average\s*=\s*(\d+)\s*ms/is);
            const avgMatch =
              out.match(/Average\s*=\s*(\d+)\s*ms/i) ||
              out.match(/Mittelwert\s*=\s*(\d+)\s*ms/i) ||
              out.match(/Moyenne\s*=\s*(\d+)\s*ms/i);
            if (minMax) {
              sample.minMs = Number(minMax[1]);
              sample.maxMs = Number(minMax[2]);
              sample.avgMs = Number(minMax[3]);
              sample.ok = true;
            } else if (avgMatch) {
              sample.avgMs = Number(avgMatch[1]);
              sample.ok = true;
            }
          }
          if (error && !sample.ok) sample.error = String((error as Error).message ?? error).slice(0, 200);
        } catch (e) {
          sample.error = String(e).slice(0, 200);
        }
        done(sample);
      }
    );
    child.on("error", (e) => done({ ip, ok: false, avgMs: null, error: String(e.message).slice(0, 200) }));
  });
}

async function dnsQueryTime(serverIp: string, hostname = "google.com", timeoutMs = 3500): Promise<number | null> {
  const resolver = new Resolver();
  try {
    resolver.setServers([serverIp]);
    // Catch on the query itself: after a race timeout the late rejection
    // would otherwise surface as an unhandled rejection.
    const query = resolver.resolve4(hostname).catch((): null => null);
    const t0 = Date.now();
    const t = await Promise.race([
      query,
      new Promise<null>((res) => setTimeout(() => res(null), timeoutMs)),
    ]);
    if (!t) return null;
    return Date.now() - t0;
  } catch {
    return null;
  } finally {
    try {
      resolver.cancel();
    } catch {
      /* noop */
    }
  }
}

/** Ping a single IP (4 echoes, worst dropped) + best-of-3 DNS queries. */
export async function pingHost(ip: string): Promise<PingSample> {
  const s = await pingOnce(ip, 4);
  if (s.ok) {
    const qs = (
      await Promise.all([dnsQueryTime(ip), dnsQueryTime(ip), dnsQueryTime(ip)].map((p) => p.catch(() => null)))
    ).filter((x): x is number => typeof x === "number");
    // Minimum: local jitter inflates slow queries; the fastest reflects the server.
    s.dnsMs = qs.length ? Math.min(...qs) : null;
  }
  return s;
}

export async function benchmarkProvider(
  providerId: string,
  primary: string,
  secondary: string
): Promise<ProviderResult> {
  const [a, b] = await Promise.all([pingOnce(primary, 4), pingOnce(secondary, 4)]);
  // Best of 3 DNS queries against the faster host (min defeats local jitter).
  const target = a.avgMs != null && b.avgMs != null ? (a.avgMs <= b.avgMs ? primary : secondary) : primary;
  const qAll = await Promise.all(
    [dnsQueryTime(target), dnsQueryTime(target), dnsQueryTime(target)].map((p) => p.catch(() => null))
  );
  const qs = qAll.filter((x): x is number => typeof x === "number");
  const dnsMs = qs.length ? Math.min(...qs) : null;
  a.dnsMs = target === primary ? dnsMs : undefined;
  b.dnsMs = target === secondary ? dnsMs : undefined;

  const bestAvgMs =
    a.avgMs != null && b.avgMs != null
      ? Math.min(a.avgMs, b.avgMs)
      : a.avgMs ?? b.avgMs ?? null;
  // Ranking score: prefer ping, fall back to DNS time. Weighted combo when both exist.
  let scoreMs: number | null = null;
  if (bestAvgMs != null && dnsMs != null) scoreMs = Math.round(bestAvgMs * 0.7 + dnsMs * 0.3);
  else scoreMs = bestAvgMs ?? dnsMs ?? null;

  return { providerId, primary, secondary, primaryPing: a, secondaryPing: b, bestAvgMs, dnsQueryMs: dnsMs, scoreMs };
}

/** Run with limited concurrency (2) so a slow link isn't flooded by its own test. */
export async function benchmarkAll(
  providers: { id: string; primary: string; secondary: string }[],
  onProgress?: (done: number, total: number, label: string) => void,
  concurrency = 2
): Promise<ProviderResult[]> {
  const results: ProviderResult[] = [];
  let done = 0;
  const queue = [...providers];
  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      if (!p) break;
      onProgress?.(done, providers.length, p.id);
      try {
        const r = await benchmarkProvider(p.id, p.primary, p.secondary);
        results.push(r);
      } catch {
        results.push({
          providerId: p.id,
          primary: p.primary,
          secondary: p.secondary,
          primaryPing: { ip: p.primary, ok: false, avgMs: null },
          secondaryPing: { ip: p.secondary, ok: false, avgMs: null },
          bestAvgMs: null,
          dnsQueryMs: null,
          scoreMs: null,
        });
      }
      done++;
      onProgress?.(done, providers.length, p.id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, providers.length) }, () => worker()));
  // sort: reachable first by score, unreachable last
  return results.sort((x, y) => (x.scoreMs ?? 1e9) - (y.scoreMs ?? 1e9));
}
