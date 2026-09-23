# Changelog

All notable changes to DNS Switcher are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.1] - 2026-09-23

### Fixed

- Speed-test top-3 and provider badges now show the same ping numbers.
  (They previously mixed the ranking score with raw ping, which looked
  like stale data.) Single-row pings also fold into the shared ranking,
  and Apply refuses unreachable results.

## [1.0.0] - 2026-09-22

Initial release.

### Added

- Per-adapter DNS switching (Wi-Fi / Ethernet) across 12 providers —
  Cloudflare, Google, Quad9, OpenDNS, AdGuard (+ Family), CleanBrowsing,
  Comodo, Lumen, Verisign, Control D, NextDNS — plus Custom and
  Automatic (DHCP).
- Speed test: ICMP ping (worst sample dropped) + real DNS-query timing,
  ranked 1-2-3 with one-click Apply. Ping badges, per-row Ping, fastest
  crown all share one consistent ranking.
- Registry-backed DHCP-vs-static detection — router DNS reads as Automatic,
  never "Custom"; the Connection toggle sticks.
- Tray-first behavior: close/minimize collapses to tray, quick-switch menu
  (incl. Automatic), single instance, launch at startup, start minimized.
- Always-admin mode: auto-elevates on launch with one UAC prompt
  (single-instance-safe synchronous handoff); optional silent elevated
  autostart via Task Scheduler.
- Custom topmost overlay popups (theme-aware, fade in/out) instead of
  Windows notification-center spam; in-app toasts when open.
- Minimal monochrome UI with light/dark themes, no-flash themed first
  paint, fluid 3-column layout on wide windows.
- Dashboard + Settings views, custom adapter dropdown, custom DNS,
  DNS cache flush (automatic on every apply, manual button included).
- Windows builds for x64, ARM64, and 32-bit as portable ZIPs.

### Fixed

- Elevated relaunch killing the new instance via the single-instance lock.
- PowerShell argument splitting on paths with spaces (dev-mode elevation).
- Portable builds self-destructing on elevate (TEMP cleanup) — replaced
  by stable-path ZIP distribution; broken NSIS shortcuts removed.
- Blank/white windows via software rendering + crash auto-reload guard.
- Benchmark self-congestion (limited parallelism) and first-echo skew.

### Security

- Context-isolated renderer, no `nodeIntegration`, strict CSP on all
  windows, IPv4-validated custom DNS input.
