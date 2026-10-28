// Isolated-world script: owns chrome.storage and relays config to page.js
// (which runs in the page so it can reach Excalidraw's app state).
(() => {
  const X = globalThis.XT_SHARED;

  async function load() {
    const { config } = await chrome.storage.sync.get("config");
    return X.mergeConfig(config);
  }

  function send(cfg) {
    document.dispatchEvent(new CustomEvent("xt:config", { detail: JSON.stringify(cfg) }));
  }

  document.addEventListener("xt:ready", async () => send(await load()));

  // page.js reports the tools it finds so the options page can list them.
  document.addEventListener("xt:tools", e => {
    try { chrome.storage.local.set({ discovered: JSON.parse(e.detail) }); } catch (_) {}
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.config) send(X.mergeConfig(changes.config.newValue));
  });

  load().then(send);
})();
