// Main-world script: keybinds, toolbar CSS, and palettes.
(() => {
  if (window.__xtLoaded) return;
  window.__xtLoaded = true;

  // Self-contained on purpose: Chrome injects a file only once per page, so
  // shared.js (already used by bridge.js) is not available in this world.
  const X = {
    EXCALIDRAW_PICKS: {
      stroke: ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"],
      background: ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"]
    },
    MODS: ["ctrl", "alt", "shift", "meta"],
    normCombo(s) {
      const parts = String(s || "").toLowerCase().split("+").map(p => p.trim()).filter(Boolean);
      if (!parts.length) return "";
      const key = parts.pop();
      const alias = { control: "ctrl", cmd: "meta", command: "meta", win: "meta", option: "alt" };
      const mods = new Set(parts.map(p => alias[p] || p));
      return [...this.MODS.filter(m => mods.has(m)), key].join("+");
    },
    normMods(s) {
      return this.normCombo(String(s || "") + "+x").slice(0, -2);
    }
  };
  const TOOLBAR = '.App-toolbar .Stack_horizontal:has(> [data-testid^="toolbar-"])';

  let config = null;
  let tools = {};          // id -> { label, defaultKeys }
  let toolOrder = [];      // ids in Excalidraw's DOM order
  let keyMap = new Map();  // combo -> tool id
  let defaultKeys = new Set();
  let lastToolSig = "";
  let lastToolDetail = "";
  let paletteApplied = false;

  const style = document.createElement("style");
  style.id = "excalidraw-tweaks";
  document.documentElement.appendChild(style);

  // ---------- Excalidraw internals ----------

  function getApp() {
    const root = document.querySelector(".excalidraw");
    if (!root) return null;
    const fk = Object.keys(root).find(k => k.startsWith("__reactFiber"));
    let f = fk && root[fk];
    for (let d = 0; f && d < 300; d++, f = f.return) {
      const sn = f.stateNode;
      if (sn && sn.state && "colorTopPicks" in sn.state && typeof sn.updateScene === "function") return sn;
    }
    return null;
  }

  // ---------- tools ----------

  // "More tools" (the ⋮ menu) isn't a tool button; it lives inside a
  // display:contents wrapper, so it needs its own selectors.
  const MORE = "more";
  const MORE_BTN = ".App-toolbar__extra-tools-trigger";
  const MORE_DIVIDER = `${TOOLBAR} > .App-toolbar__divider:has(+ .dropdown-menu-event-wrapper)`;

  // Tools that normally live only in the "More tools" menu. They can be pinned
  // to the toolbar as real buttons. Hidden (unpinned) unless you turn them on.
  // Icons are copied from Excalidraw's menu; `type` is what the menu sets.
  const EXTRAS = {
    lasso: { label: "Lasso selection", keys: [], icon: '<svg viewBox="0 0 22 22" fill="none" stroke-width="1.25"><g stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M4.028 13.252c-.657 -.972 -1.028 -2.078 -1.028 -3.252c0 -3.866 4.03 -7 9 -7s9 3.134 9 7s-4.03 7 -9 7c-1.913 0 -3.686 -.464 -5.144 -1.255"></path><path d="M5 15m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path><path d="M5 17c0 1.42 .316 2.805 1 4"></path></g></svg>' },
    laser: { label: "Laser pointer", keys: ["k"], icon: '<svg viewBox="0 0 20 20"><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" transform="rotate(90 10 10)"><path clip-rule="evenodd" d="m9.644 13.69 7.774-7.773a2.357 2.357 0 0 0-3.334-3.334l-7.773 7.774L8 12l1.643 1.69Z"></path><path d="m13.25 3.417 3.333 3.333M10 10l2-2M5 15l3-3M2.156 17.894l1-1M5.453 19.029l-.144-1.407M2.377 11.887l.866 1.118M8.354 17.273l-1.194-.758M.953 14.652l1.408.13"></path></g></svg>' },
    frame: { label: "Frame tool", keys: ["f"], icon: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><g stroke-width="1.5"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M4 7l16 0"></path><path d="M4 17l16 0"></path><path d="M7 4l0 16"></path><path d="M17 4l0 16"></path></g></svg>' },
    bucketfill: { label: "Bucket fill", keys: ["b"], icon: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><g stroke-width="1.25"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M5 16l1.465 1.638a2 2 0 1 1 -3.015 .099l1.55 -1.737z"></path><path d="M13.737 9.737c2.299 -2.3 3.23 -5.095 2.081 -6.245c-1.15 -1.15 -3.945 -.217 -6.244 2.082c-2.3 2.299 -3.231 5.095 -2.082 6.244c1.15 1.15 3.946 .218 6.245 -2.081z"></path><path d="M7.492 11.818c.362 .362 .768 .676 1.208 .934l6.895 4.047c1.078 .557 2.255 -.075 3.692 -1.512c1.437 -1.437 2.07 -2.614 1.512 -3.692c-.372 -.718 -1.72 -3.017 -4.047 -6.895a6.015 6.015 0 0 0 -.934 -1.208"></path></g></svg>' },
    autoshape: { label: "Draw to shape", keys: ["shift+x"], icon: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><g stroke-width="1.5"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M3 9.5a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0"></path><path d="M10 12a2 2 0 0 1 2 -2h7a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-7a2 2 0 0 1 -2 -2l0 -7"></path></g></svg>' }
  };

  function toolSel(id) {
    if (id === MORE) return `${TOOLBAR} ${MORE_BTN}`;
    if (EXTRAS[id]) return `${TOOLBAR} > [data-xt-pin="${id}"]`;
    return `${TOOLBAR} > [data-testid="toolbar-${id}"]`;
  }

  function isHidden(id) {
    const h = toolCfg(id).hidden;
    return typeof h === "boolean" ? h : !!EXTRAS[id]; // pinned extras are opt-in
  }

  // ---------- pinned extra tools ----------

  function ensurePins(stack) {
    const template = stack.querySelector(':scope > [data-testid^="toolbar-"]:not([data-testid="toolbar-lock"])');
    if (!template) return;
    for (const [id, x] of Object.entries(EXTRAS)) {
      let b = stack.querySelector(`:scope > [data-xt-pin="${id}"]`);
      const keys = config ? effectiveKeys(id) : x.keys;
      const hint = keys.find(k => k.length === 1) || "";
      if (!b) {
        b = template.cloneNode(false);
        b.removeAttribute("data-testid");
        b.removeAttribute("aria-keyshortcuts");
        b.classList.remove("ToolIcon--checked");
        b.dataset.xtPin = id;
        b.setAttribute("aria-label", x.label);
        b.innerHTML = `<div class="ToolIcon__icon">${x.icon}<span class="ToolIcon__keybinding"></span></div>`;
        b.addEventListener("click", e => {
          e.preventDefault();
          const app = getApp();
          if (app) app.setActiveTool({ type: id });
          syncPins();
        });
        stack.appendChild(b);
      }
      b.title = hint ? `${x.label} — ${hint.toUpperCase()}` : x.label;
      const kb = b.querySelector(".ToolIcon__keybinding");
      if (kb && kb.textContent !== hint.toUpperCase()) kb.textContent = hint.toUpperCase();
    }
  }

  function syncPins() {
    const app = getApp();
    const active = app && app.state.activeTool && app.state.activeTool.type;
    document.querySelectorAll(`${TOOLBAR} > [data-xt-pin]`).forEach(b => {
      const on = b.dataset.xtPin === active;
      if (b.classList.contains("ToolIcon--checked") !== on) b.classList.toggle("ToolIcon--checked", on);
      const v = on ? "true" : "false";
      if (b.getAttribute("aria-pressed") !== v) b.setAttribute("aria-pressed", v);
    });
  }

  function discover() {
    const stack = document.querySelector(TOOLBAR);
    if (!stack) return;
    // Direct children only: items inside the open "More tools" menu also
    // carry toolbar-* test ids and must not be picked up as toolbar tools.
    const btns = stack.querySelectorAll(':scope > [data-testid^="toolbar-"]');
    if (!btns.length) return;
    const found = {};
    const order = [];
    btns.forEach(b => {
      const id = b.dataset.testid.slice("toolbar-".length);
      const raw = b.getAttribute("aria-keyshortcuts") || "";
      found[id] = {
        label: b.getAttribute("aria-label") || id,
        icon: (b.querySelector(".ToolIcon__icon svg") || b.querySelector("svg"))?.outerHTML || "",
        defaultKeys: raw.split(/\s+or\s+/i).map(k => X.normCombo(k)).filter(Boolean)
      };
      order.push(id);
    });
    const more = stack.querySelector(MORE_BTN);
    if (more) {
      found[MORE] = { label: more.title || "More tools", icon: more.querySelector("svg")?.outerHTML || "", defaultKeys: [] };
      order.push(MORE);
    }
    for (const [id, x] of Object.entries(EXTRAS)) {
      found[id] = { label: x.label, icon: x.icon, defaultKeys: x.keys, extra: true };
      order.push(id);
    }
    const sig = JSON.stringify([order, found]);
    if (sig === lastToolSig) return;
    lastToolSig = sig;
    tools = found;
    toolOrder = order;
    lastToolDetail = JSON.stringify({ order, tools: found });
    reportTools();
    rebuild();
  }

  // Sent again whenever config arrives, so the settings page gets the tool list
  // even if bridge.js wasn't listening yet the first time.
  function reportTools() {
    if (lastToolDetail) document.dispatchEvent(new CustomEvent("xt:tools", { detail: lastToolDetail }));
  }

  function toolCfg(id) {
    return (config && config.tools && config.tools[id]) || {};
  }

  function effectiveKeys(id) {
    const c = toolCfg(id);
    if (Array.isArray(c.keys)) return c.keys.map(k => X.normCombo(k)).filter(Boolean);
    return (tools[id] && tools[id].defaultKeys) || (EXTRAS[id] && EXTRAS[id].keys) || [];
  }

  function rebuild() {
    keyMap = new Map();
    defaultKeys = new Set();
    for (const id of toolOrder) {
      tools[id].defaultKeys.forEach(k => defaultKeys.add(k));
      if (!config) continue;
      for (const k of effectiveKeys(id)) if (!keyMap.has(k)) keyMap.set(k, id);
    }

    let css =
      // Quick picks as a fixed 5-column grid so extra rows line up under the first.
      ".excalidraw .color-picker__top-picks{display:grid!important;grid-template-columns:repeat(5,max-content);justify-content:space-between;align-content:start;gap:5px}" +
      ".excalidraw .color-picker-container > .active-color{align-self:start}";

    if (config) {
      for (const id of toolOrder) {
        if (isHidden(id)) css += `${toolSel(id)}{display:none!important}`;
      }
      if (isHidden(MORE)) css += `${MORE_DIVIDER}{display:none!important}`;
      const wanted = (config.order || []).filter(id => tools[id]);
      if (wanted.length) {
        const full = [...wanted, ...toolOrder.filter(id => !wanted.includes(id))];
        css += `${TOOLBAR} > *, ${TOOLBAR} ${MORE_BTN}{order:9999}`;
        full.forEach((id, i) => { css += `${toolSel(id)}{order:${i * 2}}`; });
        const more = full.indexOf(MORE);
        if (more >= 0) css += `${MORE_DIVIDER}{order:${more * 2 - 1}}`;
        const lock = full.indexOf("lock");
        if (lock >= 0) css += `${TOOLBAR} > [data-testid="toolbar-lock"] + .App-toolbar__divider{order:${lock * 2 + 1}}`;
      }
    }
    style.textContent = css;
    const stack = document.querySelector(TOOLBAR);
    if (stack && config) ensurePins(stack);
  }

  // ---------- interface ----------
  // Excalidraw's dark theme is CSS: a block of variables on .excalidraw.theme--dark
  // plus some dark-only rules. We copy those rules onto light mode under a class
  // on <html>, minus --theme-filter. The canvas stays in light mode, so colors
  // are drawn exactly as picked.

  const uiStyle = document.createElement("style");
  uiStyle.id = "excalidraw-tweaks-ui";
  document.documentElement.appendChild(uiStyle);
  let darkCss = "";

  function buildDarkCss() {
    const out = [];
    const conv = sel => sel.split(",").map(x => {
      x = x.trim();
      if (!x.includes("theme--dark")) return null;
      if (x.startsWith(":root.theme--dark")) return x.replace(":root.theme--dark", ":root.xt-dark-ui");
      return "html.xt-dark-ui " + x.replace(/\.theme--dark/g, ":not(.theme--dark)");
    }).filter(Boolean).join(", ");
    const walk = (rules, wrap) => {
      for (const r of rules) {
        if (r.cssRules && !r.selectorText) {
          if (r.media) walk(r.cssRules, `@media ${r.media.mediaText}`);
          continue;
        }
        if (!r.selectorText || !r.selectorText.includes("theme--dark")) continue;
        const sel = conv(r.selectorText);
        const body = r.style.cssText.replace(/--theme-filter\s*:[^;]*;?/g, "");
        if (!sel || !body.trim()) continue;
        out.push(wrap ? `${wrap}{${sel}{${body}}}` : `${sel}{${body}}`);
      }
    };
    for (const sh of document.styleSheets) {
      const id = sh.ownerNode && sh.ownerNode.id;
      if (id === "excalidraw-tweaks" || id === "excalidraw-tweaks-ui") continue;
      try { walk(sh.cssRules); } catch (_) { /* cross-origin sheet */ }
    }
    return out.join("\n");
  }

  const isHexColor = v => /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v || "");

  function applyUi() {
    const ui = (config && config.ui) || {};
    let css = "";
    if (ui.dark) {
      if (!darkCss) darkCss = buildDarkCss();
      css += darkCss;
    }
    document.documentElement.classList.toggle("xt-dark-ui", !!ui.dark && !!darkCss);
    if (isHexColor(ui.panel)) {
      css += `\nhtml .excalidraw.excalidraw{--island-bg-color:${ui.panel}!important;--island-bg-color-alt:${ui.panel}!important;--popup-bg-color:${ui.panel}!important}`;
    }
    if (uiStyle.textContent !== css) uiStyle.textContent = css;
  }

  // ---------- palettes ----------

  function applyPalettes() {
    if (!config) return;
    const app = getApp();
    if (!app) return;
    const cur = app.state.colorTopPicks || {};
    const next = { ...cur };
    let changed = false;
    for (const [cfgKey, stateKey] of [["stroke", "elementStroke"], ["background", "elementBackground"]]) {
      const p = config.palettes[cfgKey];
      if (p == null) continue; // leave Excalidraw's own picks alone
      const want = p.length ? p : null; // [] = Excalidraw defaults
      if (JSON.stringify(cur[stateKey] ?? null) !== JSON.stringify(want)) {
        next[stateKey] = want;
        changed = true;
      }
    }
    if (changed) app.updateScene({ appState: { colorTopPicks: next } });
    paletteApplied = true;
  }

  function paletteFor(target, app) {
    const p = config.palettes[target];
    if (Array.isArray(p) && p.length) return p;
    const live = app && app.state.colorTopPicks && app.state.colorTopPicks[target === "stroke" ? "elementStroke" : "elementBackground"];
    return live || X.EXCALIDRAW_PICKS[target];
  }

  function setColor(target, idx) {
    const app = getApp();
    if (!app) return false;
    const color = paletteFor(target, app)[idx];
    if (!color) return false;
    const am = app.actionManager;
    if (target === "stroke") am.executeAction(am.actions.changeStrokeColor, "ui", { currentItemStrokeColor: color });
    else am.executeAction(am.actions.changeBackgroundColor, "ui", { currentItemBackgroundColor: color });
    return true;
  }

  // ---------- keyboard ----------

  function eventKey(e) {
    const c = e.code || "";
    if (c.startsWith("Key")) return c.slice(3).toLowerCase();
    if (c.startsWith("Digit")) return c.slice(5);
    if (c.startsWith("Numpad") && /\d$/.test(c)) return c.slice(-1);
    return (e.key || "").toLowerCase();
  }

  function eventCombo(e) {
    const m = [];
    if (e.ctrlKey) m.push("ctrl");
    if (e.altKey) m.push("alt");
    if (e.shiftKey) m.push("shift");
    if (e.metaKey) m.push("meta");
    return [...m, eventKey(e)].join("+");
  }

  function colorTarget(combo) {
    const parts = combo.split("+");
    const key = parts.pop();
    if (!/^\d$/.test(key) || !parts.length) return null;
    const mods = parts.join("+");
    const ck = config.colorKeys || {};
    for (const target of ["stroke", "background"]) {
      if (ck[target] && X.normMods(ck[target]) === mods) {
        return { target, idx: key === "0" ? 9 : Number(key) - 1 };
      }
    }
    return null;
  }

  function swallow(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onKey(e) {
    if (!config || e.isComposing) return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
    // Leave the color picker, menus and dialogs to Excalidraw (the picker uses q/w/e... itself).
    if (document.querySelector("[data-radix-popper-content-wrapper], .excalidraw .Modal")) return;

    const combo = eventCombo(e);

    const ct = colorTarget(combo);
    if (ct) {
      swallow(e);
      if (!e.repeat) setColor(ct.target, ct.idx);
      return;
    }

    const id = keyMap.get(combo);
    if (id) {
      if (tools[id].defaultKeys.includes(combo)) return; // Excalidraw already does this
      swallow(e);
      if (!e.repeat) {
        const btn = document.querySelector(toolSel(id));
        if (btn) btn.click();
      }
      return;
    }

    // A default tool key you've removed or reassigned: block it.
    if (defaultKeys.has(combo)) swallow(e);
  }

  window.addEventListener("keydown", onKey, true);

  // ---------- wiring ----------

  document.addEventListener("xt:config", e => {
    try { config = JSON.parse(e.detail); } catch (_) { return; }
    paletteApplied = false;
    reportTools();
    rebuild();
    applyUi();
    applyPalettes();
  });

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      discover();
      const stack = document.querySelector(TOOLBAR);
      if (stack && config) ensurePins(stack); // only once config can hide unpinned ones
      syncPins();
      if (config && config.ui && config.ui.dark && !darkCss) applyUi();
      if (!paletteApplied) applyPalettes();
    });
  }).observe(document.body, { childList: true, subtree: true });

  // Tool changes don't add/remove nodes, so also check the active tool on input.
  for (const ev of ["pointerup", "keyup"]) window.addEventListener(ev, () => requestAnimationFrame(syncPins), true);
  setInterval(syncPins, 400);

  discover();
  document.dispatchEvent(new CustomEvent("xt:ready"));
})();
