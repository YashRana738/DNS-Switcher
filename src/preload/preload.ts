import { contextBridge, ipcRenderer } from "electron";

function listen<T>(channel: string, cb: (v: T) => void): () => void {
  const fn = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

contextBridge.exposeInMainWorld("dnsApi", {
  getState: () => ipcRenderer.invoke("app:getState"),
  apply: (args: { adapter: string; providerId: string; primary?: string; secondary?: string }) =>
    ipcRenderer.invoke("dns:apply", args),
  flush: () => ipcRenderer.invoke("dns:flush"),
  ping: (ip: string) => ipcRenderer.invoke("dns:ping", ip),
  benchmarkOne: (providerId: string) => ipcRenderer.invoke("dns:benchmarkOne", providerId),
  benchmarkAll: () => ipcRenderer.invoke("dns:benchmarkAll"),
  applyBest: (results: unknown) => ipcRenderer.invoke("dns:applyBest", results),
  updateSettings: (patch: unknown) => ipcRenderer.invoke("settings:update", patch),
  relaunchAdmin: () => ipcRenderer.invoke("app:relaunchAdmin"),
  quit: () => ipcRenderer.invoke("app:quit"),
  onBenchmarkProgress: (cb: (p: { done: number; total: number; label: string }) => void) =>
    listen("benchmark:progress", cb),
  onDnsChanged: (cb: (v: { adapter: string; providerId: string }) => void) =>
    listen("dns:changed", cb),
  onToast: (cb: (v: { msg: string; kind: string }) => void) => listen("app:toast", cb),
});

contextBridge.exposeInMainWorld("notifyApi", {
  onShow: (cb: (v: { title: string; body: string; ms: number; kind: string; theme: string }) => void) => {
    ipcRenderer.on(
      "notify:show",
      (
        _e: unknown,
        v: { title: string; body: string; ms: number; kind: string; theme: string }
      ) => cb(v)
    );
  },
  onHide: (cb: () => void) => {
    ipcRenderer.on("notify:hide", () => cb());
  },
  click: () => ipcRenderer.send("notify:click"),
});
