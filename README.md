# DNS Switcher

Minimal monochrome DNS switcher for **Windows** — benchmark providers, apply the
fastest with one click, and live in the system tray like Cloudflare WARP.

Built with **Electron + TypeScript**. No system notifications: the app shows
quiet in-app toasts, or a small topmost overlay card when collapsed to tray.

## Features

- Switch per-adapter DNS (Wi-Fi / Ethernet) across 12 providers: Cloudflare,
  Google, Quad9, OpenDNS, AdGuard (+ Family), CleanBrowsing, Comodo,
  Lumen, Verisign, Control D, NextDNS — plus Custom and Automatic (DHCP).
- **Speed test**: ICMP ping (worst sample dropped) + real DNS-query timing,
  ranked 1-2-3 with one-click **Apply**.
- Registry-backed DHCP-vs-static detection — router DNS correctly reads as
  Automatic, never "Custom".
- **Tray-first**: close/minimize collapses to tray, quick-switch menu,
  single instance, launch at startup, start minimized.
- **Always-admin mode**: auto-elevates on launch (one UAC prompt); optional
  silent elevated autostart via Task Scheduler (no UAC at logon).
- Minimal monochrome UI (light/dark, follows Windows), overlay popups instead
  of notification-center spam, zero blur/gradient effects for speed.

## Install (users)

1. Download `DNS Switcher Setup 1.0.0.exe` from
   [Releases](https://github.com/YashRana738/DNS-Switcher/releases).
2. Run it (Windows SmartScreen will warn about the unsigned publisher —
   expected for local builds; click *More info → Run anyway*).
3. Approve the UAC prompt on first launch so the app can manage DNS.

Portable alternative: `DNS-Switcher-1.0.0-portable.exe` — no install needed.

## Run from source (developers)

Prerequisites: [Node.js](https://nodejs.org/) 20+.

```powershell
npm install
npm start        # build + run
```

| Script             | What it does                              |
| ------------------ | ----------------------------------------- |
| `npm run build`    | Type-check + compile to `dist/`           |
| `npm start`        | Build and launch the app                  |
| `npm run dist`     | Build NSIS installer + portable exe       |
| `npm run clean`    | Remove `dist/` and `release/`             |
| `node scripts/fetch-icons.py`  | Re-download provider logos |
| `python scripts/fetch-icons.py`| (requires `pillow`)          |

## Project structure

```
src/
  main/        Electron main: window, tray, DNS engine, benchmark, elevation
    main.ts        app lifecycle, tray menu, overlay manager, IPC
    dnsManager.ts  adapters, DNS read/apply/flush, DHCP-vs-static detect
    benchmark.ts   ping + DNS-query timing and ranking
    providers.ts   provider list (IPs, colors, bundled logo files)
    store.ts       JSON settings in %APPDATA%/DNS Switcher
  preload/     context-bridge APIs (dnsApi, notifyApi)
  renderer/    UI: index.html + styles.css + renderer.ts (plain script)
               notify.html/css/ts (topmost overlay card)
assets/        app icon + per-provider logos (bundled, offline)
scripts/       copy-assets, clean, fetch-icons, NSIS uninstall hook
release/       build output (git-ignored)
```

## How DNS switching works

- Adapters via `Get-NetAdapter`, current DNS via `Get-DnsClientServerAddress`.
- Apply via `Set-DnsClientServerAddress` (fallback: `netsh`), then
  `ipconfig /flushdns` — flush is automatic on every change.
- DHCP-vs-static is read from the interface's `NameServer` registry value,
  so DHCP-provided (router) DNS never misreports as custom.
- Changing DNS requires elevation: the app relaunches itself as admin
  (synchronous UAC handoff, single-instance-safe). Pass `--no-elevate` to
  force a plain start.

## Uninstall

Use *Add or remove programs* as usual. The uninstaller also removes the
`DNS Switcher` logon task and Run entry. To remove the task manually:

```powershell
schtasks /delete /tn "DNS Switcher" /f
```

## CI

GitHub Actions (`.github/workflows/build.yml`) type-checks and builds the
portable exe on every push/PR, uploading it as an artifact.

## License

MIT — see [LICENSE](LICENSE).
