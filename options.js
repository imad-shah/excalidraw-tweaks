(() => {
  const X = globalThis.XT_SHARED;
  let config;
  let discovered = null; // { order, tools: { id: { label, defaultKeys } } }
  let saveTimer;

  const $ = s => document.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k in n) n[k] = v;
      else n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  };
  const fmt = combo => combo.split("+").map(p => p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)).join("+");

  function save() {
    clearTimeout(saveTimer);
    $("#status").textContent = "Saving…";
    saveTimer = setTimeout(async () => {
      await chrome.storage.sync.set({ config });
      $("#status").textContent = "Saved";
    }, 250);
  }

  // ---------- tools ----------

  let selected = null; // tool id whose settings are open
  let dragId = null;

  function fullOrder() {
    const ids = discovered.order;
    const wanted = config.order.filter(id => ids.includes(id));
    return [...wanted, ...ids.filter(id => !wanted.includes(id))];
  }

  // Pinnable extras (from the More tools menu) are hidden until turned on.
  function hidden(id) {
    const h = (config.tools[id] || {}).hidden;
    return typeof h === "boolean" ? h : !!(discovered.tools[id] && discovered.tools[id].extra);
  }

  function tcfg(id) { return config.tools[id] || (config.tools[id] = {}); }

  function effectiveKeys(id) {
    const c = config.tools[id] || {};
    return Array.isArray(c.keys) ? c.keys.map(k => X.normCombo(k)).filter(Boolean) : discovered.tools[id].defaultKeys;
  }

  function conflicts() {
    const seen = new Map();
    const bad = new Map(); // id -> other tool's label
    for (const id of discovered.order) {
      for (const k of effectiveKeys(id)) {
        const other = seen.get(k);
        if (other && other !== id) {
          bad.set(id, discovered.tools[other].label);
          bad.set(other, discovered.tools[id].label);
        } else seen.set(k, id);
      }
    }
    return bad;
  }

  // Icons come from Excalidraw's own toolbar. Parse them as SVG and strip
  // anything scriptable before putting them in the page.
  function iconNode(svg, label) {
    const wrap = el("span", { class: "ico" });
    if (svg) {
      // Parse as HTML: the markup has no xmlns, and the HTML parser puts <svg>
      // in the right namespace. DOMParser documents never run scripts.
      const doc = new DOMParser().parseFromString(svg, "text/html");
      const s = doc.body.querySelector("svg");
      if (s) {
        s.querySelectorAll("script, foreignObject, iframe").forEach(n => n.remove());
        for (const n of [s, ...s.querySelectorAll("*")]) {
          for (const a of [...n.attributes]) {
            if (/^on/i.test(a.name) || /javascript:/i.test(a.value)) n.removeAttribute(a.name);
          }
        }
        wrap.append(document.importNode(s, true));
        return wrap;
      }
    }
    wrap.textContent = (label || "?")[0];
    return wrap;
  }

  function renderTools() {
    const box = $("#tools");
    box.textContent = "";
    if (!discovered) {
      box.append(el("p", { class: "empty", textContent: "Open excalidraw.com once with the extension installed, then come back here. The toolbar is read from the live site." }));
      return;
    }
    const order = fullOrder();
    const bad = conflicts();
    if (!selected || !discovered.tools[selected]) selected = order.find(id => id === "freedraw") || order[0];

    const bar = el("div", { class: "bar" });
    order.forEach((id, i) => {
      const t = discovered.tools[id];
      const c = config.tools[id] || {};
      const keys = effectiveKeys(id);
      const tile = el("button", {
        type: "button",
        class: "tile" + (hidden(id) ? " off" : "") + (id === selected ? " sel" : "") + (bad.has(id) ? " bad" : ""),
        title: `${t.label}${hidden(id) ? " (hidden)" : ""} — click to edit, double-click to ${hidden(id) ? "show" : "hide"}, drag to move`,
        draggable: true,
        onclick: e => {
          if (e.detail >= 2) { selected = id; tcfg(id).hidden = !hidden(id); save(); renderTools(); return; }
          selected = id;
          bar.querySelectorAll(".tile.sel").forEach(n => n.classList.remove("sel"));
          e.currentTarget.classList.add("sel");
          renderDetail();
        }
      }, iconNode(t.icon, t.label));
      tile.dataset.id = id;
      if (keys.length) tile.append(el("span", { class: "key", textContent: keys.map(k => k.includes("+") ? "…" : k.toUpperCase())[0] }));

      tile.addEventListener("dragstart", e => {
        dragId = id;
        tile.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
      });
      tile.addEventListener("dragend", () => { dragId = null; renderTools(); });
      tile.addEventListener("dragover", e => {
        if (!dragId || dragId === id) return;
        e.preventDefault();
        const r = tile.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        bar.querySelectorAll(".drop-before, .drop-after").forEach(n => n.classList.remove("drop-before", "drop-after"));
        tile.classList.add(after ? "drop-after" : "drop-before");
      });
      tile.addEventListener("drop", e => {
        e.preventDefault();
        if (!dragId || dragId === id) return;
        const after = tile.classList.contains("drop-after");
        const next = order.filter(x => x !== dragId);
        next.splice(next.indexOf(id) + (after ? 1 : 0), 0, dragId);
        config.order = next;
        dragId = null;
        save(); renderTools();
      });

      bar.append(tile);
      if (id === "lock" && i < order.length - 1) bar.append(el("span", { class: "divider" }));
    });
    box.append(bar);
    if (order.includes("more")) {
      box.append(el("p", { class: "hint", style: "margin:8px 0 0", textContent: "⋮ is Excalidraw's \u201cMore tools\u201d menu. The tools after it (lasso, laser, frame, bucket fill, draw to shape) come from that menu: double-click one to pin it to your toolbar. You can hide ⋮ itself; menu shortcuts like F and K keep working." }));
    }
    const detailHost = el("div");
    box.append(detailHost);
    renderDetail();

    box.append(el("div", { class: "row-actions", style: "margin-top:12px" },
      el("button", { type: "button", textContent: "Reset order", onclick: () => { config.order = []; save(); renderTools(); } })
    ));

    function renderDetail() {
    const bad = conflicts();
    const t = discovered.tools[selected];
    const c = config.tools[selected] || {};
    const custom = Array.isArray(c.keys);
    const id = selected;

    const keyInput = el("input", {
      type: "text",
      value: effectiveKeys(id).map(fmt).join(", "),
      placeholder: "no shortcut",
      class: bad.has(id) ? "conflict" : "",
      spellcheck: false,
      onchange: e => {
        tcfg(id).keys = e.target.value.split(",").map(s => X.normCombo(s)).filter(Boolean);
        save(); renderTools();
      }
    });

    detailHost.replaceChildren(el("div", { class: "detail" },
      el("div", { class: "detail-head" },
        iconNode(t.icon, t.label),
        el("div", {},
          el("div", { class: "detail-name", textContent: t.label }),
          el("div", { class: "detail-sub", textContent: "Excalidraw default: " + (t.defaultKeys.map(fmt).join(", ") || "no shortcut") })
        ),
        el("button", {
          type: "button",
          class: "toggle" + (hidden(id) ? " is-off" : ""),
          textContent: hidden(id) ? "Hidden — click to show" : "Shown — click to hide",
          onclick: () => { tcfg(id).hidden = !hidden(id); save(); renderTools(); }
        })
      ),
      el("label", { class: "field" },
        el("span", { textContent: "Shortcuts" }),
        keyInput
      ),
      el("div", { class: "detail-foot" },
        bad.has(id) ? el("span", { class: "warn", textContent: `Also used by ${bad.get(id)}` }) : el("span", {}),
        custom ? el("button", { type: "button", class: "link", textContent: "Use Excalidraw default", onclick: () => { delete tcfg(id).keys; save(); renderTools(); } }) : null
      )
    ));
    }
  }

  // ---------- palettes ----------

  const isHex = s => /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s);
  const toHex6 = s => {
    if (!isHex(s)) return "#000000";
    if (s.length === 4) return "#" + [...s.slice(1)].map(c => c + c).join("");
    return s.slice(0, 7);
  };

  let swatchDrag = null; // { target, i }

  function renderPalettes() {
    const box = $("#palettes");
    box.textContent = "";
    for (const target of ["stroke", "background"]) {
      const custom = Array.isArray(config.palettes[target]) && config.palettes[target].length;
      const colors = custom ? config.palettes[target] : X.EXCALIDRAW_PICKS[target];
      const set = arr => { config.palettes[target] = arr; save(); renderPalettes(); };
      const editable = () => colors.slice();

      box.append(el("div", { class: "palette-head" },
        el("h2", { textContent: target === "stroke" ? "Stroke" : "Background" }),
        el("span", { class: "hint", style: "margin:0", textContent: custom ? `${colors.length} color${colors.length === 1 ? "" : "s"}` : "Excalidraw defaults" })
      ));

      const grid = el("div", { class: "swatches" });
      colors.forEach((color, i) => {
        const transparent = color === "transparent";
        const chip = el("button", {
          type: "button",
          class: "chip" + (transparent ? " transparent" : ""),
          style: transparent ? "" : `background:${color}`,
          title: "Pick from the color spectrum",
          onclick: e => openSpectrum(e.currentTarget, hex => { const a = editable(); a[i] = hex; set(a); })
        });
        const card = el("div", { class: "swatch", title: "Drag to reorder" },
          chip,
          el("input", { type: "text", value: color, spellcheck: false,
            onchange: e => {
              const v = e.target.value.trim().toLowerCase();
              if (v !== "transparent" && !isHex(v)) { e.target.classList.add("conflict"); return; }
              const a = editable(); a[i] = v; set(a);
            } }),
          el("div", { class: "ctrl" },
            el("span", { class: "grip", textContent: "⠿ " + (i < 10 ? `#${(i + 1) % 10}` : "") }),
            el("button", { textContent: "✕", title: "Remove", disabled: colors.length <= 1, onclick: () => { const a = editable(); a.splice(i, 1); set(a); } })
          )
        );

        // Same drag-to-reorder as the toolbar. Not draggable while pressing in
        // the hex field, so selecting text there still works.
        card.draggable = true;
        card.addEventListener("pointerdown", e => { card.draggable = !(e.target instanceof HTMLInputElement); });
        card.addEventListener("dragstart", e => {
          swatchDrag = { target, i };
          card.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", color);
        });
        card.addEventListener("dragend", () => { swatchDrag = null; renderPalettes(); });
        card.addEventListener("dragover", e => {
          if (!swatchDrag || swatchDrag.target !== target || swatchDrag.i === i) return;
          e.preventDefault();
          const r = card.getBoundingClientRect();
          grid.querySelectorAll(".drop-before, .drop-after").forEach(n => n.classList.remove("drop-before", "drop-after"));
          card.classList.add(e.clientX > r.left + r.width / 2 ? "drop-after" : "drop-before");
        });
        card.addEventListener("drop", e => {
          e.preventDefault();
          if (!swatchDrag || swatchDrag.target !== target || swatchDrag.i === i) return;
          const after = card.classList.contains("drop-after");
          const a = editable();
          const [moved] = a.splice(swatchDrag.i, 1);
          let at = i + (after ? 1 : 0);
          if (swatchDrag.i < at) at--;
          a.splice(at, 0, moved);
          swatchDrag = null;
          set(a);
        });
        grid.append(card);
      });
      box.append(grid);
      box.append(el("div", { class: "row-actions" },
        el("button", { textContent: "+ Add color", onclick: () => { const a = editable(); a.push(target === "stroke" ? "#ffffff" : "#343a40"); set(a); } }),
        custom ? el("button", { textContent: "Use Excalidraw defaults", onclick: () => set([]) }) : null
      ));
    }
  }

  // ---------- color spectrum popover ----------
  // One small image with every hue (left→right) at every lightness (top→bottom),
  // plus a gray strip. Hover to read the hex, click to use it.

  const hslToHex = (h, s, l) => {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return "#" + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  };

  const SPEC_W = 240, SPEC_H = 140, GRAY_H = 16;
  const specColor = (x, y) => hslToHex((x / SPEC_W) * 360, 100, 97 - (y / SPEC_H) * 94);
  const grayColor = x => { const v = Math.round(255 - (x / SPEC_W) * 255).toString(16).padStart(2, "0"); return "#" + v + v + v; };

  let spectrum = null;

  function closeSpectrum() {
    if (!spectrum) return;
    spectrum.remove();
    spectrum = null;
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onEsc, true);
  }
  function onOutside(e) { if (spectrum && !spectrum.contains(e.target)) closeSpectrum(); }
  function onEsc(e) { if (e.key === "Escape") closeSpectrum(); }

  function paintCanvas(canvas, w, h, colorAt) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    if (h === GRAY_H) {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, "#fff"); g.addColorStop(1, "#000");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      return;
    }
    for (let x = 0; x < w; x++) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, colorAt(x, (i / 10) * h));
      ctx.fillStyle = g; ctx.fillRect(x, 0, 1.5, h);
    }
  }

  function openSpectrum(anchor, onPick) {
    closeSpectrum();
    const preview = el("span", { class: "spec-preview" });
    const hexOut = el("span", { class: "spec-hex", textContent: "hover a color" });
    let current = null;
    const show = hex => { current = hex; preview.style.background = hex; hexOut.textContent = hex; };

    const mk = (h, colorAt) => {
      const c = el("canvas", { class: "spec-canvas" });
      paintCanvas(c, SPEC_W, h, colorAt);
      const at = e => { const r = c.getBoundingClientRect(); return [Math.max(0, Math.min(SPEC_W - 0.01, e.clientX - r.left)), Math.max(0, Math.min(h - 0.01, e.clientY - r.top))]; };
      c.addEventListener("mousemove", e => { const [x, y] = at(e); show(h === GRAY_H ? grayColor(x) : specColor(x, y)); });
      c.addEventListener("click", e => { const [x, y] = at(e); const hex = h === GRAY_H ? grayColor(x) : specColor(x, y); closeSpectrum(); onPick(hex); });
      return c;
    };

    const copyBtn = el("button", {
      type: "button", class: "spec-copy", textContent: "Copy",
      onclick: async () => {
        if (!current) return;
        try { await navigator.clipboard.writeText(current); copyBtn.textContent = "Copied"; setTimeout(() => (copyBtn.textContent = "Copy"), 900); } catch (_) {}
      }
    });

    spectrum = el("div", { class: "spectrum", role: "dialog", "aria-label": "Color spectrum" },
      mk(SPEC_H, specColor),
      mk(GRAY_H, null),
      el("div", { class: "spec-row" }, preview, hexOut, copyBtn),
      el("div", { class: "spec-tip", textContent: "Click to use · Esc to close" })
    );
    document.body.append(spectrum);
    const r = anchor.getBoundingClientRect();
    const w = spectrum.offsetWidth, hgt = spectrum.offsetHeight;
    let left = r.left + window.scrollX;
    left = Math.max(8, Math.min(left, window.scrollX + document.documentElement.clientWidth - w - 8));
    let top = r.bottom + window.scrollY + 6;
    if (r.bottom + hgt + 6 > window.innerHeight && r.top - hgt - 6 > 0) top = r.top + window.scrollY - hgt - 6;
    spectrum.style.left = left + "px";
    spectrum.style.top = top + "px";
    setTimeout(() => {
      document.addEventListener("mousedown", onOutside, true);
      document.addEventListener("keydown", onEsc, true);
    });
  }

  // ---------- color hotkeys ----------

  function renderColorKeys() {
    for (const target of ["stroke", "background"]) {
      const input = $(`#ck-${target}`);
      input.value = config.colorKeys[target] || "";
      input.onchange = e => {
        const v = e.target.value.trim();
        config.colorKeys[target] = v ? X.normMods(v) : "";
        e.target.value = config.colorKeys[target];
        save();
      };
    }
  }

  // ---------- init ----------

  // ---------- interface ----------

  function renderUi() {
    const ui = config.ui;
    const dark = $("#ui-dark");
    dark.checked = !!ui.dark;
    dark.onchange = () => { ui.dark = dark.checked; save(); };

    const chip = $("#ui-panel-chip"), input = $("#ui-panel");
    const paint = () => {
      input.value = ui.panel || "";
      input.classList.remove("conflict");
      chip.style.background = isHex(ui.panel) ? ui.panel : "";
    };
    const setPanel = v => { ui.panel = v; save(); paint(); };
    chip.onclick = () => openSpectrum(chip, setPanel);
    input.onchange = () => {
      const v = input.value.trim().toLowerCase();
      if (!v) return setPanel("");
      if (!isHex(v)) { input.classList.add("conflict"); return; }
      setPanel(v);
    };
    $("#ui-panel-reset").onclick = () => setPanel("");
    paint();
  }

  // ---------- export / import ----------

  const ID_RE = /^[a-z0-9_-]{1,40}$/;
  const isColor = v => v === "transparent" || isHex(v);

  // Accepts an exported file (or a bare config) and keeps only well-formed
  // fields, so a hand-edited or foreign file can't put junk into settings.
  function sanitize(raw) {
    const src = raw && typeof raw === "object" && raw.config && typeof raw.config === "object" ? raw.config : raw;
    if (!src || typeof src !== "object" || Array.isArray(src)) throw new Error("This file doesn't contain Excalidraw Tweaks settings.");
    const known = ["tools", "order", "palettes", "colorKeys", "ui"];
    if (!known.some(k => k in src)) throw new Error("This file doesn't contain Excalidraw Tweaks settings.");

    const out = {};
    if (src.tools && typeof src.tools === "object") {
      out.tools = {};
      for (const [id, t] of Object.entries(src.tools).slice(0, 100)) {
        if (!ID_RE.test(id) || !t || typeof t !== "object") continue;
        const c = {};
        if (typeof t.hidden === "boolean") c.hidden = t.hidden;
        if (Array.isArray(t.keys)) c.keys = t.keys.filter(k => typeof k === "string" && k.length <= 30).map(k => X.normCombo(k)).filter(Boolean).slice(0, 10);
        out.tools[id] = c;
      }
    }
    if (Array.isArray(src.order)) out.order = src.order.filter(id => typeof id === "string" && ID_RE.test(id)).slice(0, 100);
    if (src.palettes && typeof src.palettes === "object") {
      out.palettes = {};
      for (const k of ["stroke", "background"]) {
        const p = src.palettes[k];
        if (p === null) out.palettes[k] = null;
        else if (Array.isArray(p)) out.palettes[k] = p.filter(c => typeof c === "string").map(c => c.trim().toLowerCase()).filter(isColor).slice(0, 40);
      }
    }
    if (src.colorKeys && typeof src.colorKeys === "object") {
      out.colorKeys = {};
      for (const k of ["stroke", "background"]) {
        const v = src.colorKeys[k];
        if (typeof v === "string" && v.length <= 30) out.colorKeys[k] = v ? X.normMods(v) : "";
      }
    }
    if (src.ui && typeof src.ui === "object") {
      out.ui = {};
      if (typeof src.ui.dark === "boolean") out.ui.dark = src.ui.dark;
      if (src.ui.panel === "" || isHex(String(src.ui.panel || "").toLowerCase())) out.ui.panel = String(src.ui.panel || "").toLowerCase();
    }
    return X.mergeConfig(out);
  }

  function ioStatus(msg, bad) {
    const s = $("#io-status");
    s.textContent = msg;
    s.classList.toggle("warn", !!bad);
  }

  $("#export").onclick = () => {
    const file = {
      app: "excalidraw-tweaks",
      format: 1,
      exportedAt: new Date().toISOString(),
      config
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: `excalidraw-tweaks-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ioStatus("Exported. Import that file anywhere to get this exact setup.");
  };

  $("#import").onclick = () => $("#import-file").click();
  $("#import-file").onchange = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      if (f.size > 200000) throw new Error("That file is too large to be a settings file.");
      let parsed;
      try { parsed = JSON.parse(await f.text()); } catch (_) { throw new Error("That file isn't valid JSON."); }
      const next = sanitize(parsed);
      if (!confirm(`Replace your current settings with "${f.name}"?`)) return;
      config = next;
      save(); renderAll();
      ioStatus(`Imported "${f.name}". Open Excalidraw tabs update right away.`);
    } catch (err) {
      ioStatus(err.message || "Couldn't import that file.", true);
    }
  };

  function renderAll() { renderTools(); renderPalettes(); renderColorKeys(); renderUi(); }

  $("#reset-all").onclick = () => {
    if (!confirm("Reset everything to stock Excalidraw? This shows every tool, restores the original order, shortcuts and colors.")) return;
    // Empty tools/order = Excalidraw's own toolbar; [] palettes = Excalidraw's own colors
    // (null would leave whatever custom colors are currently on the site).
    config = X.mergeConfig({ tools: {}, order: [], palettes: { stroke: [], background: [] } });
    save(); renderAll();
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.discovered) { discovered = changes.discovered.newValue; renderTools(); }
  });

  Promise.all([chrome.storage.sync.get("config"), chrome.storage.local.get("discovered")]).then(([s, l]) => {
    config = X.mergeConfig(s.config);
    discovered = l.discovered || null;
    renderAll();
  });
})();
