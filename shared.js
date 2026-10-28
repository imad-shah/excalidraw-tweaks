// Shared defaults and helpers. Loaded in the extension's isolated world,
// in the page's main world, and on the options page.
globalThis.XT_SHARED = globalThis.XT_SHARED || {
  // tools.<id>.keys: omitted = Excalidraw's own keys, [] = no shortcut.
  // tools.<id>.hidden: remove the button from the toolbar.
  // order: tool ids in the order you want; tools not listed keep their place after these.
  // palettes.<stroke|background>: null = leave Excalidraw's quick picks alone,
  //   [] = restore Excalidraw's defaults, [colors...] = your quick picks (5 per row).
  // colorKeys: modifier(s) + 1..9,0 picks the Nth color from that palette.
  DEFAULTS: {
    tools: {}, // fresh install = stock Excalidraw toolbar
    order: [],
    palettes: { stroke: null, background: null },
    colorKeys: { stroke: "alt", background: "alt+shift" },
    // ui.dark: Excalidraw's dark interface while the canvas stays in light mode
    // (true colors). ui.panel: optional hex for toolbar/panel backgrounds.
    ui: { dark: false, panel: "" }
  },

  // Excalidraw's built-in quick picks, used when you haven't set your own.
  EXCALIDRAW_PICKS: {
    stroke: ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"],
    background: ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"]
  },

  MODS: ["ctrl", "alt", "shift", "meta"],

  // "Shift+Alt+3" -> "alt+shift+3"
  normCombo(s) {
    const parts = String(s || "").toLowerCase().split("+").map(p => p.trim()).filter(Boolean);
    if (!parts.length) return "";
    const key = parts.pop();
    const alias = { control: "ctrl", cmd: "meta", command: "meta", win: "meta", option: "alt" };
    const mods = new Set(parts.map(p => alias[p] || p));
    return [...this.MODS.filter(m => mods.has(m)), key].join("+");
  },

  // "alt + shift" -> "alt+shift"
  normMods(s) {
    const c = this.normCombo(String(s || "") + "+x");
    return c.slice(0, -2);
  },

  mergeConfig(stored) {
    const d = this.DEFAULTS;
    const s = stored || {};
    return {
      tools: s.tools || structuredClone(d.tools),
      order: Array.isArray(s.order) ? s.order : [],
      palettes: { ...d.palettes, ...(s.palettes || {}) },
      colorKeys: { ...d.colorKeys, ...(s.colorKeys || {}) },
      ui: { ...d.ui, ...(s.ui || {}) }
    };
  }
};
