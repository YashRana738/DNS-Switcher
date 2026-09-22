/* Overlay toast renderer — plain script, no modules. */

interface NotifyPayload {
  title: string;
  body: string;
  ms: number;
  kind: string;
  theme: "light" | "dark";
}

interface Window {
  notifyApi: {
    onShow(cb: (v: NotifyPayload) => void): void;
    onHide(cb: () => void): void;
    click(): void;
  };
}

function show(v: NotifyPayload): void {
  document.documentElement.dataset.theme = v.theme === "dark" ? "dark" : "light";
  const card = document.getElementById("card");
  const title = document.getElementById("title");
  const body = document.getElementById("body");
  if (card) card.className = "card" + (v.kind === "error" ? " error" : "");
  if (title) title.textContent = v.title || "DNS Switcher";
  if (body) body.textContent = v.body || "";
}

function hide(): void {
  document.getElementById("card")?.classList.add("leaving");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("card")?.addEventListener("click", () => window.notifyApi.click());
  window.notifyApi.onShow(show);
  window.notifyApi.onHide(hide);
});
