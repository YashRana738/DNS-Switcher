# DNS Switcher

[![Release](https://img.shields.io/github/v/release/YashRana738/DNS-Switcher?style=flat-square)](https://github.com/YashRana738/DNS-Switcher/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square)](https://github.com/YashRana738/DNS-Switcher/releases)
[![License](https://img.shields.io/github/license/YashRana738/DNS-Switcher?style=flat-square)](LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/YashRana738/DNS-Switcher/build.yml?style=flat-square)](https://github.com/YashRana738/DNS-Switcher/actions)

A minimal, monochrome DNS switcher for **Windows**. Benchmark every major
provider, apply the fastest with one click, and let the app live quietly in
the system tray — in the spirit of Cloudflare WARP.

Built with **Electron + TypeScript**. No notification-center spam: the app
shows quiet in-app toasts, or a small topmost overlay card when collapsed
to the tray.

---

## Download

Get the latest release for your architecture from the
[**Releases**](https://github.com/YashRana738/DNS-Switcher/releases) page.

| Architecture | Portable zip (extract & run, no install) |
| --- | --- |
| x64 (most PCs) | `DNS-Switcher-1.0.1-x64.zip` |
| ARM64 (Snapdragon / Surface) | `DNS-Switcher-1.0.1-arm64.zip` |
| 32-bit (x86) | `DNS-Switcher-1.0.1-ia32.zip` |

Extract anywhere permanent (e.g. Documents) and run `DNS Switcher.exe`
inside — keep the folder, the app relaunches from it when elevating.

> Windows SmartScreen will warn about the unsigned publisher on first run —
> expected for community builds. Click *More info → Run anyway*, then approve
> the UAC prompt so the app can manage DNS.

## Features

- **12 providers + Custom + Automatic (DHCP)** — Cloudflare, Google, Quad9,
  OpenDNS, AdGuard (+ Family), CleanBrowsing, Comodo, Lumen, Verisign,
  Control D, NextDNS.
- **Speed test** — ICMP ping (worst sample dropped) plus real DNS-query
  timing, ranked 1-2-3 with one-click **Apply**.
- **Correct auto-detection** — registry-backed DHCP-vs-static check, so
  router DNS reads as Automatic and never as "Custom".
- **Tray-first** — close/minimize collapses to tray, quick-switch menu,
  single instance, launch at startup, start minimized.
- **Always-admin mode** — auto-elevates on launch with a single UAC prompt;
  optional silent elevated autostart (no UAC at logon).
- **Minimal monochrome UI** — light/dark following Windows, overlay popups
  instead of notifications, zero blur/gradient effects for speed.

## For developers

Prerequisites: [Node.js](https://nodejs.org/) 20+.

```powershell
npm install
npm start        # build + run
```

| Script | Purpose |
| --- | --- |
| `npm run build` | Type-check + compile to `dist/` |
| `npm start` | Build and launch the app |
| `npm run dist` | ZIP packages for all Windows archs |
| `npm run clean` | Remove `dist/` and `release/` |

### Project layout

```
src/
  main/        window, tray, DNS engine, benchmark, elevation, IPC
    main.ts / dnsManager.ts / benchmark.ts / providers.ts / store.ts
  preload/     context-bridge APIs (dnsApi, notifyApi)
  renderer/    UI: index.html + styles.css + renderer.ts
               notify.html/css/ts (topmost overlay card)
assets/        app icon + bundled provider logos (works offline)
scripts/       asset copy, clean, icon fetcher, NSIS uninstall hook
```

### How DNS switching works

- Adapters via `Get-NetAdapter`, current DNS via `Get-DnsClientServerAddress`.
- Apply via `Set-DnsClientServerAddress` (fallback: `netsh`), followed by an
  automatic `ipconfig /flushdns` on every change.
- DHCP-vs-static comes from the interface's `NameServer` registry value.
- Elevation uses a synchronous UAC handoff that is single-instance safe.
  Pass `--no-elevate` to force a plain start.

### CI

GitHub Actions type-checks and packages the portable exes (x64, ARM64, 32-bit)
on every push and pull request.

## Removing the app

Portable build — just delete the extracted folder. If you enabled *Launch at Windows
startup*, also remove the logon task and settings:

```powershell
schtasks /delete /tn "DNS Switcher" /f
```

## License

MIT — see [LICENSE](LICENSE).
