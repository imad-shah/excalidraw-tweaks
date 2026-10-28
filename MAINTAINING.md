# Excalidraw Tweaks: maintainer handoff

Everything needed to understand, debug and fix this extension without starting from zero.
Written 2026-10-28 against the live excalidraw.com of that day, at extension **v0.6.2**,
when every feature was confirmed working.

> **If something broke:** Excalidraw almost certainly changed, not this code. Go to
> [§9 Diagnose in 5 minutes](#9-diagnose-in-5-minutes), run the snippets on excalidraw.com,
> and compare the output with the "known good" values recorded in [§4](#4-the-excalidraw-contract-everything-we-depend-on).
> The mismatch tells you which line to change.

---

## Contents

1. [What it does](#1-what-it-does)
2. [Files](#2-files)
3. [Architecture](#3-architecture)
4. [The Excalidraw contract (everything we depend on)](#4-the-excalidraw-contract-everything-we-depend-on)
5. [Feature → code → dependency map](#5-feature--code--dependency-map)
6. [Settings format](#6-settings-format)
7. [Bug history and gotchas (read before changing anything)](#7-bug-history-and-gotchas-read-before-changing-anything)
8. [Background: why the dark-mode workaround exists](#8-background-why-the-dark-mode-workaround-exists)
9. [Diagnose in 5 minutes](#9-diagnose-in-5-minutes)
10. [How to test](#10-how-to-test)
11. [Install, update, ship](#11-install-update-ship)
12. [Version history](#12-version-history)
13. [Known gaps and ideas](#13-known-gaps-and-ideas)

---

## 1. What it does

A Manifest V3 Chrome extension for **https://excalidraw.com only**. It:

| Feature | Summary |
|---|---|
| Hide tools | Remove any toolbar button, including the ⋮ "More tools" menu button. |
| Reorder tools | Drag tiles on the settings page; applied on the site with CSS `order`. |
| Remap shortcuts | Any tool can have several shortcuts (e.g. pencil = `P, 3`). Default keys taken away from a tool are blocked. |
| Pin extra tools | Lasso, laser, frame, bucket fill, draw-to-shape (normally only inside ⋮) get real, permanent toolbar buttons. |
| Custom quick-pick colors | Replaces the swatch row next to Stroke/Background with your own list (any length; wraps in rows of 5). |
| Color hotkeys | `Alt+1..9,0` picks stroke color N; `Alt+Shift+1..9,0` picks background color N (modifiers configurable). |
| Spectrum picker | Settings page only: click a swatch → hue/lightness image + gray strip; hover shows hex, click applies. |
| Dark interface in light mode | Excalidraw's dark UI styling while the canvas stays in light mode (true colors). Optional custom panel color. |
| Export / import | One JSON file with the whole setup; import validates every field. |

The intended workflow: Excalidraw in **light mode**, canvas background set to near-black from ☰ → Canvas background,
"Dark interface in light mode" on. A typical setup hides tools you don't use (e.g. eraser, rectangle, diamond, arrow, ⋮),
pins lasso (e.g. on `E`), gives the pencil two keys (`P, 3`) and uses a custom stroke palette. An exported JSON file is the
source of truth for a given setup.

---

## 2. Files

```
excalidraw-tweaks/
├── manifest.json     MV3 manifest. Two content-script entries (isolated + MAIN world), options page, action → options.
├── shared.js         Defaults, key-combo normalizer, mergeConfig(). Used by bridge.js (isolated world) and the options page.
├── bridge.js         Isolated world. Owns chrome.storage; relays config to page.js and tool list back to storage.
├── page.js           MAIN world (runs inside excalidraw.com's JS context). All on-site behavior. SELF-CONTAINED (see §7.1).
├── background.js     One line: toolbar icon click opens the settings page.
├── options.html      Settings page markup + all CSS (light/dark via prefers-color-scheme).
├── options.js        Settings page logic: toolbar editor, palettes, spectrum picker, interface, hotkeys, export/import, reset.
└── MAINTAINING.md    This file.
```

`manifest.json` essentials:

```json
"permissions": ["storage"],
"content_scripts": [
  { "matches": ["https://excalidraw.com/*"], "js": ["shared.js", "bridge.js"], "run_at": "document_idle" },
  { "matches": ["https://excalidraw.com/*"], "js": ["page.js"], "run_at": "document_idle", "world": "MAIN" }
]
```

No host permissions beyond the content-script match, no network access, no remote code.

---

## 3. Architecture

### 3.1 Why two worlds

- **page.js must run in the page's MAIN world** to read React internals (`__reactFiber…` keys on DOM nodes) and call
  Excalidraw's App instance. Content scripts in the isolated world can see the DOM but not page JS objects/expandos.
- **MAIN world has no `chrome.storage`**, so bridge.js (isolated world) owns storage and talks to page.js through
  `CustomEvent`s on `document` (both worlds share the DOM). Payloads are JSON **strings** (objects don't cross worlds reliably).

### 3.2 Message flow

```
options page ──chrome.storage.sync.set({config})──► storage
                                                     │ onChanged
bridge.js (isolated) ◄───────────────────────────────┘
   │  dispatch "xt:config" (detail = JSON string of merged config)
   ▼
page.js (MAIN) ── applies config: rebuild() CSS + keymap, applyUi(), applyPalettes(), ensurePins()
   │  dispatch "xt:tools" (detail = JSON {order, tools}) whenever toolbar is (re)discovered,
   │  and again on every xt:config (so a late-listening bridge still gets it)
   ▼
bridge.js ──chrome.storage.local.set({discovered})──► options page reads it to draw the toolbar editor
```

Startup handshake: bridge.js sends `xt:config` immediately on load **and** in response to `xt:ready`, which page.js
fires at the end of its init. Either script may run first; both orders work.

### 3.3 Storage keys

| Area | Key | Content |
|---|---|---|
| `chrome.storage.sync` | `config` | The saved settings (§6). Item quota is 8 KB; current configs are ~1–2 KB. |
| `chrome.storage.local` | `discovered` | `{ order: [ids], tools: { id: { label, icon (svg string), defaultKeys: [combos], extra?: true } } }` reported by page.js from the live toolbar. The settings page needs this to draw tiles; empty until excalidraw.com has been opened once. |

Excalidraw's own storage that we touch indirectly: `localStorage["excalidraw-state"].colorTopPicks` (written by
Excalidraw when we call `updateScene`, see §4.2).

### 3.4 page.js runtime loop

- `MutationObserver` on `document.body` (childList, subtree), coalesced with `requestAnimationFrame`:
  `discover()` → `ensurePins()` (only once config exists) → `syncPins()` → retry `applyUi()` if dark CSS wasn't built yet → `applyPalettes()` until it has succeeded once per config.
- `pointerup`/`keyup` listeners + `setInterval(syncPins, 400)` keep pinned-button highlight in sync (tool changes only flip attributes, not nodes).
- `keydown` listener on `window` in **capture** phase (`onKey`), so it runs before Excalidraw's handlers.
- Two `<style>` elements appended to `<html>`: `#excalidraw-tweaks` (toolbar + swatch-grid CSS, from `rebuild()`) and `#excalidraw-tweaks-ui` (dark UI + panel color, from `applyUi()`).
- Guard `window.__xtLoaded` prevents double init.

---

## 4. The Excalidraw contract (everything we depend on)

These are the exact internals observed on 2026-10-28. Each entry: what it is, where we use it, and how to re-check it.

### 4.1 Getting the App instance (React fiber walk)

```js
const root = document.querySelector(".excalidraw");            // container div
const fk = Object.keys(root).find(k => k.startsWith("__reactFiber")); // e.g. "__reactFiber$ab12cd"
let f = root[fk];
while (f) { const sn = f.stateNode;
  if (sn && sn.state && "colorTopPicks" in sn.state && typeof sn.updateScene === "function") return sn; // App
  f = f.return; }
```

- Found at depth ≈56 walking `.return` from the `.excalidraw` div (we allow 300).
- **Identification uses `state.colorTopPicks` + `updateScene`.** If `colorTopPicks` is ever renamed, `getApp()` returns
  null and palettes, color hotkeys and pinned tools all stop at once. Fix: identify by another stable state key
  (e.g. `"activeTool" in sn.state && sn.actionManager`) and update palette code separately.
- Container classes observed: `"excalidraw excalidraw-container notranslate"` (+ `theme--dark` in dark mode; **no** `theme--light` class in light mode).

### 4.2 App instance members used

| Member | Used by | Observed shape |
|---|---|---|
| `app.state.colorTopPicks` | palettes | `{ elementStroke, elementBackground, bucketFill, stickyNoteStroke, stickyNoteBackground }`, each `null` (= Excalidraw default 5) or an array of color strings of **any length** (rendered in the swatch row). Persisted by Excalidraw to `localStorage["excalidraw-state"].colorTopPicks`. |
| `app.updateScene({ appState: { colorTopPicks } })` | `applyPalettes()` | Sets state; Excalidraw re-renders the swatch row and persists it. |
| `app.state.activeTool.type` | `syncPins()` | e.g. `"freedraw"`, `"selection"`, `"lasso"`. Full object: `{type, customType, locked, fromSelection, lastActiveTool}`. |
| `app.setActiveTool({ type })` | pinned buttons | **Accepts any string without validation** (`"bucketFill"` was accepted and does nothing). Only use types verified by clicking the real menu item (§4.6). |
| `app.actionManager.actions.changeStrokeColor` / `.changeBackgroundColor` | color hotkeys | `app.actionManager.executeAction(action, "ui", { currentItemStrokeColor: "#hex" })` / `{ currentItemBackgroundColor }`. Applies to selected elements and to the next drawn element. |
| Other actions seen (unused) | | `changeBucketFillBackgroundColor`, `changeStrokeWidth`, `changeStrokeStyle`, `changeViewBackgroundColor`, `changeExportBackground`. |
| `app.state.viewBackgroundColor` | (not used) | Canvas background. User sets it via ☰ → Canvas background. |

Color-picker component props seen while debugging (React fiber above a top-pick button, depth ≈19–22):
`{ theme, activeColor, onChange(), type: "elementStroke", topPicks, isCustomized, onReset() }` and
`{ topPicks, palette, customizableTopPicks: "elementStroke", excludedColors, type, label: "Stroke", color, onChange(), elements, appState, updateData() }`.
Excalidraw has native "drag a color onto top picks to pin it" + a "Reset" link; that is what `isCustomized/onReset` serve.
Our config re-applies on page load, so native pinning is overwritten by the extension's palette when one is set.

### 4.3 Toolbar DOM

Selector used everywhere: `TOOLBAR = '.App-toolbar .Stack_horizontal:has(> [data-testid^="toolbar-"])'`

Children of that stack, in DOM order (2026-10-28):

```
button[data-testid=toolbar-lock]        title "Keep selected tool active after drawing — Q"
div.App-toolbar__divider
button[data-testid=toolbar-hand]        aria-keyshortcuts "H"
button[data-testid=toolbar-selection]   "V or 1"
button[data-testid=toolbar-rectangle]   "R or 2"
button[data-testid=toolbar-diamond]     "D or 3"
button[data-testid=toolbar-ellipse]     "O or 4"
button[data-testid=toolbar-arrow]       "A or 5"
button[data-testid=toolbar-line]        "L or 6"
button[data-testid=toolbar-freedraw]    "P or 7"
button[data-testid=toolbar-text]        "T or 8"
button[data-testid=toolbar-stickynote]  "N"
button[data-testid=toolbar-eraser]      "E or 0"
div.App-toolbar__divider
div.dropdown-menu-event-wrapper  (display: contents!)
   └─ button.dropdown-menu-button.App-toolbar__extra-tools-trigger[data-testid=dropdown-menu-button][title="More tools"]
   └─ (when open) div.dropdown-menu … items (see §4.6)
(+ our injected button[data-xt-pin=<id>] elements, appended at the end)
```

Note `toolbar-lock` has no `aria-keyshortcuts` attribute even though its title says Q; we treat it as having no default keys.

A tool button (outerHTML, svg elided):

```html
<button class="ToolIcon ToolIcon_type_toggle ToolIcon_size_medium" type="button"
  title="Draw — P or 7" aria-label="Draw" aria-keyshortcuts="P or 7" aria-pressed="false"
  data-testid="toolbar-freedraw" aria-disabled="false">
  <div class="ToolIcon__icon"><svg …/><span class="ToolIcon__keybinding">P</span></div>
</button>
```

- Active tool: class `ToolIcon--checked` + `aria-pressed="true"`.
- The little letter in the corner is `span.ToolIcon__keybinding` (only present when the tool has a letter key). For native tools it always shows Excalidraw's default letter even if remapped; we don't touch native buttons' contents (React owns them).
- Default shortcuts are parsed from `aria-keyshortcuts` by splitting on `" or "` and normalizing (`"P or 7"` → `["p","7"]`).
- **Calling `.click()` on a `display:none` button still fires its handler.** Remapped shortcuts rely on this for hidden tools.
- Injecting our own buttons into the React-managed stack works: tested through tool switches and forced theme re-renders, nodes survive. If a toolbar remount ever drops them, the MutationObserver re-adds them.

### 4.4 Color picker DOM

```
.color-picker-container            display:grid; grid-template-columns: 130px 15px 26px
  .color-picker__top-picks.top-picks-dnd    (native: display:flex; justify-content: space-between) ← we force a 5-col grid
     button.color-picker__button.top-picks-dnd__pick[title="#hex"][data-top-pick-index]
  <divider>
  button.color-picker__button.active-color.properties-trigger   (opens the big picker popover)
```

- Big picker popover lives in `[data-radix-popper-content-wrapper]`; it has its own letter shortcuts
  (q w e r t / a s d f g / z x c v b, shift+1..5 for shades). **onKey() steps aside whenever this wrapper exists.**
- Dialogs: `.excalidraw .Modal`, also skipped by onKey().

### 4.5 Theme / CSS

- Dark mode = `.excalidraw.theme--dark` on the container. Light mode = no theme class.
- Main dark rule `.excalidraw.theme--dark { … }` declares **71 custom properties** (appears twice in the sheets),
  including `--theme-filter: invert(93%) hue-rotate(180deg)`. Light default: `.excalidraw { --theme-filter: none; … }`.
- ~38 other rules contain `theme--dark`, e.g. `.excalidraw.theme--dark .QuickSearch__wrapper`,
  `.excalidraw.theme--dark.excalidraw .dropdown-menu .dropdown-menu-container`, `:root.theme--dark .shape-actions-theme-scope`.
- Panel-related variables (dark values): `--island-bg-color:#232329`, `--island-bg-color-alt:hsl(240,12%,12%)`,
  `--default-bg-color:#121212`, `--input-bg-color:#121212`, `--input-border-color:#2e2e2e`, `--popup-text-color:#ced4da`,
  `--button-gray-1:#363636`, `--button-gray-2:#272727`, `--button-gray-3:#222`. Our panel color overrides
  `--island-bg-color`, `--island-bg-color-alt`, `--popup-bg-color`.
- `--theme-filter` is now only used for library thumbnails and embedded SVG images
  (`.library-unit__preview > svg { filter: var(--theme-filter) }`). **The canvas itself is NOT CSS-filtered any more**
  (`getComputedStyle(canvas).filter === "none"`); dark-mode color transformation happens in JS (§8).

### 4.6 "More tools" menu items

Opening the ⋮ menu renders (data-testid → label → default key):

| data-testid | Label | Key | `activeTool.type` set by clicking it |
|---|---|---|---|
| `toolbar-image` | Insert image | 9 | (opens file picker; not a pinnable tool) |
| `toolbar-frame` | Frame tool | F | `frame` |
| `toolbar-embeddable` | Web Embed | | `embeddable` |
| `toolbar-autoshape` | Draw to shape | Shift+X | `autoshape` |
| `toolbar-laser` | Laser pointer | K | `laser` |
| `toolbar-bucketfill` | Bucket fill | B | `bucketfill` |
| `toolbar-lasso` | Lasso selection | (none) | `lasso` |
| (no testid) | Text to diagram (AI) | | |
| `toolbar-embeddable` (**duplicate id!**) | Mermaid to Excalidraw | | |
| `toolbar-magicframe` | Wireframe to code (AI) | | |

Because these items also carry `toolbar-*` test ids, discovery must only look at **direct children** of the stack (§7.3).
When a menu-only tool is active, Excalidraw shows that tool's icon on the ⋮ trigger; switching away reverts it to ⋮
(this behavior is why pinning exists).

The pinned-tool icons in `page.js` `EXTRAS` were copied verbatim from these menu items' SVGs.

### 4.7 Excalidraw localStorage keys (FYI)

`excalidraw-state` (appState incl. `theme`, `colorTopPicks`, `currentItem*`), `excalidraw-theme`, `excalidraw` (elements),
`version-dataState`, `i18nextLng`. We never write these directly.

---

## 5. Feature → code → dependency map

| Feature | Code (page.js unless noted) | Depends on (§) | Symptom if that dependency changes |
|---|---|---|---|
| Tool discovery | `discover()` | 4.3 `TOOLBAR`, `data-testid^="toolbar-"`, `aria-keyshortcuts`, `aria-label`, `.ToolIcon__icon svg` | Settings page shows "Open excalidraw.com once…" forever; nothing applies. |
| Hide tools | `rebuild()` → `display:none` via `toolSel(id)` | 4.3 | Hidden tools reappear. |
| Reorder | `rebuild()` → CSS `order` (tools at even numbers, dividers odd) | 4.3, flex layout of the stack | Order reverts / jumbles. |
| ⋮ hide/reorder | `MORE_BTN`, `MORE_DIVIDER`, `toolSel("more")` | 4.3 `.App-toolbar__extra-tools-trigger`, `.dropdown-menu-event-wrapper`, display:contents | ⋮ can't be hidden, or jumps next to the lock (§7.4). |
| Shortcuts | `onKey()`, `keyMap`, `defaultKeys`, `eventCombo()` | 4.3 default keys; `KeyboardEvent.code` | Remaps ignored, or default keys not blocked. |
| Pinned tools | `EXTRAS`, `ensurePins()`, `syncPins()` | 4.1, 4.2 `setActiveTool`, `activeTool.type`, 4.3 button classes, 4.6 types | Button visible but does nothing (renamed type) / never highlights / missing styling. |
| Palettes | `applyPalettes()` | 4.1, 4.2 `colorTopPicks`, `updateScene` | Swatch row shows Excalidraw defaults. |
| Swatch grid | CSS in `rebuild()` | 4.4 classes | Extra rows misaligned (spread to edges). |
| Color hotkeys | `colorTarget()`, `setColor()` | 4.2 `actionManager.actions.change*Color` | Alt+N does nothing (and is still swallowed). |
| Dark interface | `buildDarkCss()`, `applyUi()` | 4.5 `theme--dark` selectors in same-origin stylesheets | UI stays light. |
| Panel color | `applyUi()` | 4.5 variable names | Panels keep default color. |
| Settings page tiles | options.js `renderTools()` | `discovered` from page.js | n/a (follows discovery). |

---

## 6. Settings format

Stored at `chrome.storage.sync.config`; always passed through `mergeConfig()` (shared.js) which fills defaults.

```jsonc
{
  "tools": {
    // per tool id (Excalidraw testid suffix, "more", or an EXTRAS id)
    "freedraw": { "keys": ["p", "3"] },          // keys omitted = Excalidraw defaults; [] = no shortcut
    "eraser":   { "hidden": true, "keys": [] },  // hidden omitted = shown (for normal tools)
    "lasso":    { "hidden": false, "keys": ["e"] } // EXTRAS: hidden omitted = HIDDEN (opt-in pins)
  },
  "order": ["lock","selection","freedraw","line","text","lasso", "..."], // [] = Excalidraw order; unknown ids ignored; missing ids appended in DOM order
  "palettes": {
    "stroke": ["#020202","#fbfbfb","#fa0024"],   // custom list (any length)
    "background": ["transparent"]                // null = leave the site's picks alone; [] = force Excalidraw defaults
  },
  "colorKeys": { "stroke": "alt", "background": "alt+shift" }, // "" disables
  "ui": { "dark": true, "panel": "" }            // panel "" = Excalidraw default, else "#hex"
}
```

Key-combo format: lowercase, modifiers in fixed order `ctrl+alt+shift+meta+key`, key from `KeyboardEvent.code`
(`KeyE` → `e`, `Digit3` → `3`, `Numpad3` → `3`), otherwise `event.key` lowercased. Aliases accepted on input:
control→ctrl, cmd/command/win→meta, option→alt.

**`DEFAULTS` in shared.js** (first install): stock Excalidraw toolbar (`tools: {}`, `order: []`), palettes `null`
(site's own picks untouched), colorKeys alt / alt+shift, ui off. **Reset button** writes
`{tools:{}, order:[], palettes:{stroke:[],background:[]}}` + default colorKeys/ui, i.e. also forces Excalidraw's default colors back.

Export file:

```json
{ "app": "excalidraw-tweaks", "format": 1, "exportedAt": "ISO date", "config": { …as above… } }
```

Import (`sanitize()` in options.js) accepts that or a bare config; keeps only: tool ids matching `^[a-z0-9_-]{1,40}$`
(max 100), `hidden` booleans, keys (≤30 chars, normalized, max 10), order ids (max 100), colors that are `transparent`
or `#hex` (max 40 per palette), colorKeys strings, `ui.dark` boolean, `ui.panel` hex or "". Files >200 KB rejected.
Asks for confirmation before replacing.

---

## 7. Bug history and gotchas (read before changing anything)

Each of these actually happened during development. They encode non-obvious constraints.

1. **Chrome injects a given file only once per page.** shared.js was listed in both content-script entries; only the
   isolated world got it, so `XT_SHARED` was undefined in page.js → crash on the first toolbar read → shortcuts and hiding
   silently dead while palettes (which didn't use it) worked. **page.js must stay self-contained** (it has its own copy of
   `normCombo`, `normMods`, default picks). If you change normalization, change it in both shared.js and page.js.
2. **Startup race.** page.js's first `xt:tools` could fire before bridge.js was listening, and the signature cache stopped
   it re-sending → settings page never got the tool list. Fix: `reportTools()` re-sends on every `xt:config`.
3. **Menu items look like tools.** Items inside the ⋮ menu also have `data-testid="toolbar-*"`; a global
   `.App-toolbar [data-testid^="toolbar-"]` query picked them up whenever the menu was open. Fix: `:scope >` direct children only.
4. **`display: contents` wrapper ignores `order`.** The ⋮ trigger's wrapper has `display:contents`, so `order` on the
   wrapper does nothing and the trigger (order 0 by default) jumped right after the lock. Fix: set `order` on
   `.App-toolbar__extra-tools-trigger` itself.
5. **Swatch row uses `justify-content: space-between`.** With >5 picks the partial second row spread to the edges.
   Fix: force `display:grid; grid-template-columns: repeat(5, max-content)`.
6. **Copied SVGs have no `xmlns`.** Parsing them with `DOMParser(…, "image/svg+xml")` produced elements in the wrong
   namespace (invisible). Fix: parse as `"text/html"` and take `body.querySelector("svg")`; then strip `script`,
   `foreignObject`, `on*` attributes, `javascript:` values (options.js `iconNode()`).
7. **Double-click never fired** because the first click re-rendered the tile row (new nodes). Fix: single click only
   toggles classes + `renderDetail()`; `e.detail >= 2` toggles hidden.
8. **"Reset" used the extension's starter defaults** (which, before 0.6.2, hid some tools) so it looked like reset didn't work. Now resets to stock.
9. **`palettes: null` vs `[]`.** `null` means "don't touch"; it does **not** restore Excalidraw's picks if custom ones are
   already applied. Anything meant to restore defaults must write `[]`.
10. **`setActiveTool` accepts any type string.** Never trust it to validate; verify types by clicking real menu items.
11. **Pinned buttons flashed** before config arrived (no hide CSS yet). `ensurePins()` now waits for config.
12. **Old "Accurate Colors" userstyles** (override `--theme-filter`) no longer affect the canvas; see §8.
13. **Unpacked extension identity is its folder path.** Removing the extension deletes its storage. Different machines
    = different extension IDs = separate `storage.sync`. Export/import is the portability mechanism.
14. **`chrome.storage.sync` item limit is 8 KB.** Fine today; don't store icons or large data in `config`.
15. **Text selection inside a draggable card** breaks drag-or-select. Swatch cards set `draggable=false` on
    `pointerdown` inside the hex `<input>`.
16. **Swallowed keys:** color-hotkey combos are swallowed even if the palette slot is empty. Default tool keys you've
    unassigned are swallowed so they don't fall back to the original tool.

---

## 8. Background: why the dark-mode workaround exists

The original problem: in Excalidraw **dark mode**, colors are transformed, so a true bright red is impossible.

- Excalidraw stores real colors but renders dark mode by transforming each color in JS. Minified source (2026-10-28):
  `QP = "invert(93%) hue-rotate(180deg)"`, and the per-color function
  `GP = e => { rgb = parse(e); s = HP(r,g,b, zP /*180*/); o = yJ(s.r,s.g,s.b); … }` where `HP` is the standard
  CSS hue-rotate matrix and `yJ` is a 93% invert (`FP = 93`): `(v - 255*0.93) / (1 - 1.86)` clamped.
  The same `QP` filter is applied to images on canvas in dark mode (`ctx.filter = QP`).
- Brute force over input colors showed the closest achievable to `#ff0000` in dark mode is about `#b9550f`: hue-rotate
  plus partial inversion can't produce saturated red. So no input-color trick or CSS override can fix dark mode.
- **Solution:** stay in light mode (colors render exactly), set a dark canvas via ☰ → Canvas background, and make the
  *interface* dark with copied CSS (`buildDarkCss()`): every rule whose selector contains `theme--dark` is cloned with
  `.theme--dark` → `:not(.theme--dark)` under `html.xt-dark-ui`, `:root.theme--dark` → `:root.xt-dark-ui`,
  `--theme-filter` declarations removed, `@media` wrappers preserved. Canvas rendering never sees dark mode.
- Long-term alternative if this ever becomes impossible: self-host a fork of Excalidraw (MIT) and change the dark-mode transform.

---

## 9. Diagnose in 5 minutes

Open excalidraw.com, DevTools → Console. (The extension's own errors show with `chrome-extension://…/page.js` in the stack.)

**9.1 Is the extension running and healthy?**

```js
({
  loaded: !!window.__xtLoaded,
  toolbarStyle: document.getElementById("excalidraw-tweaks")?.textContent.length,   // 231 = swatch-grid CSS only; larger once tools are hidden/reordered
  uiStyle: document.getElementById("excalidraw-tweaks-ui")?.textContent.length,      // >0 when dark UI on
  darkClass: document.documentElement.classList.contains("xt-dark-ui"),
  pins: [...document.querySelectorAll("[data-xt-pin]")].map(b => b.dataset.xtPin),
})
```

**9.2 Toolbar contract (§4.3)**

```js
const st = document.querySelector('.App-toolbar .Stack_horizontal:has(> [data-testid^="toolbar-"])');
st ? [...st.children].map(el => (el.dataset.testid || el.dataset.xtPin || el.className) + " | " +
  (el.getAttribute("aria-keyshortcuts") || "") + " | order=" + getComputedStyle(el).order +
  " display=" + getComputedStyle(el).display).join("\n") : "TOOLBAR SELECTOR BROKEN"
```

**9.3 App instance (§4.1, §4.2)**

```js
(() => { const root = document.querySelector(".excalidraw"); if (!root) return "no .excalidraw";
  const fk = Object.keys(root).find(k => k.startsWith("__reactFiber")); if (!fk) return "no react fiber key";
  let f = root[fk], d = 0; for (; f && d < 300; d++, f = f.return) { const sn = f.stateNode;
    if (sn && sn.state && sn.updateScene) return { depth: d, hasColorTopPicks: "colorTopPicks" in sn.state,
      colorTopPicks: sn.state.colorTopPicks, activeTool: sn.state.activeTool?.type, theme: sn.state.theme,
      setActiveTool: typeof sn.setActiveTool, actions: Object.keys(sn.actionManager?.actions || {}).filter(k => /color/i.test(k)) }; }
  return "App instance not found"; })()
```

If `hasColorTopPicks` is false: find the new key in `Object.keys(sn.state).filter(k => /pick|color/i.test(k))`.

**9.4 Menu tool types (§4.6)**: open ⋮ and run

```js
[...document.querySelectorAll('.dropdown-menu [data-testid]')].map(i => i.dataset.testid + " | " + i.textContent.trim())
```

then click an item and read `activeTool.type` with 9.3.

**9.5 Dark-theme CSS (§4.5)**

```js
let n = 0, vars = 0; for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) if (r.selectorText?.includes("theme--dark")) { n++; vars = Math.max(vars, [...r.style].filter(p => p.startsWith("--")).length); } } catch (e) {} }
({ rulesWithThemeDark: n, maxVarsInOneRule: vars })   // known good: ~39 rules, 71 vars
```

**9.6 Color picker (§4.4)**: select the pencil so the panel shows, then

```js
const tp = document.querySelector(".color-picker__top-picks"); tp && ({ cls: tp.className, display: getComputedStyle(tp).display,
  buttons: [...tp.querySelectorAll("button")].map(b => b.title), parent: tp.parentElement.className })
```

**Typical fixes**

| Snippet output | Likely fix |
|---|---|
| 9.2 says selector broken | Update `TOOLBAR` in page.js. |
| Test ids renamed | Update `discover()` (`data-testid^="toolbar-"`, `slice("toolbar-".length)`) and `toolSel()`. |
| 9.3 depth found but `hasColorTopPicks` false | Rename the key in `getApp()` and `applyPalettes()`/`paletteFor()`; consider identifying App by `actionManager`. |
| `actions` list lacks `changeStrokeColor` | Find the new name; update `setColor()`. |
| 9.4 type names changed | Update `EXTRAS` keys (they're both the id and the `type`). |
| ⋮ class changed | Update `MORE_BTN` / `MORE_DIVIDER`. |
| 9.5 shows 0 rules | Theme class renamed; update `buildDarkCss()` matching + `conv()`. |

After fixing: reload the extension in `chrome://extensions`, refresh excalidraw.com, open the settings page and check
the toolbar editor shows tiles.

---

## 10. How to test

Two layers were used. Neither is checked into the folder; recreate as needed (Node + Playwright with Chromium).

### 10.1 Settings page (headless, mocked storage)

Load `options.html` via `file://` with an init script that fakes `chrome.storage`:

```js
await page.addInitScript(([discovered, config]) => {
  const sync = config ? { config } : {}, local = { discovered }, listeners = [];
  const area = (store, name) => ({
    get: async k => (k in store ? { [k]: structuredClone(store[k]) } : {}),
    set: async obj => { const ch = {}; for (const [k, v] of Object.entries(obj)) { ch[k] = { newValue: v }; store[k] = structuredClone(v); }
                        listeners.forEach(l => l(ch, name)); } });
  window.__sync = sync;
  window.chrome = { storage: { sync: area(sync, "sync"), local: area(local, "local"), onChanged: { addListener: l => listeners.push(l) } } };
}, [discoveredFixture, userConfig]);
```

`discoveredFixture` = `{ order:[…], tools:{ id:{label, defaultKeys, icon, extra?} } }` (§3.3). Accept dialogs
(`page.on("dialog", d => d.accept())`) for reset/import confirms. Things verified this way: click vs double-click,
drag reorder of tiles and swatches (`locator.dragTo` with `targetPosition`), conflict warnings, spectrum hover/click
(hot pink at x=330/360·240, y=(97−71)/94·140 reads `#ff6cb5`), export download equals saved config, import into a fresh
page reproduces it exactly, bad/foreign/hostile files rejected or stripped.

### 10.2 page.js against a toolbar replica (headless)

Build the toolbar HTML from §4.3 (including the `display:contents` wrapper and a fake open menu with `toolbar-frame`
items inside), plus a fake App reachable via a fiber key:

```js
const app = { state: { colorTopPicks: {}, activeTool: { type: "selection" } }, updateScene() {},
  setActiveTool(t) { this.state.activeTool = { type: t.type }; }, actionManager: { actions: {}, executeAction() {} } };
document.querySelector(".excalidraw").__reactFiber$test = { stateNode: app, return: null };
```

Add `page.js` with `page.addScriptTag({ path })`, dispatch `xt:config`, then check visible order by sorting
non-hidden children by `getBoundingClientRect().left`, and drive keys with `page.keyboard.press`.

### 10.3 Live site

Live checks were done by injecting the relevant code into an excalidraw.com tab through the DevTools console
(no extension install needed): CSS for dark UI and grid, a cloned pinned button + `setActiveTool`, theme-toggle re-renders.
Always clean up (reload the tab) afterwards. Never change real drawings or Excalidraw settings during tests;
if you must set `colorTopPicks` to test, restore it to `null` and verify `localStorage["excalidraw-state"]`.

---

## 11. Install, update, ship

- **Install:** `chrome://extensions` → Developer mode → Load unpacked → this folder. Open excalidraw.com once so tools are discovered.
- **Update:** overwrite files in the **same folder** → reload arrow on the extension → refresh excalidraw.com. Settings persist.
  **Never remove** the extension to update (wipes settings). Bump `version` in manifest.json for each change.
- **Back up:** settings page → Export settings. Do this after any settings change you care about.
- **Share:** send the folder (or zip) + an exported JSON. Recipient installs, opens excalidraw.com once, imports.
- Packaging used so far: `zip -r excalidraw-tweaks.zip excalidraw-tweaks`.

---

## 12. Version history

| Version | Change |
|---|---|
| 0.1.0 | First build: remap/hide/reorder via settings list, palettes, color hotkeys. Shortcuts/toolbar broken by §7.1. |
| 0.1.1 | page.js self-contained (§7.1), tool-list resend (§7.2), swatch grid alignment (§7.5). |
| 0.2.0 | Visual toolbar editor with real icons, drag reorder, crossed-out hidden tiles; SVG namespace fix (§7.6). |
| 0.3.0 | Reset to stock (§7.8), double-click hide (§7.7), ⋮ as hideable tile + ordering fix (§7.3, §7.4), spectrum picker. |
| 0.4.0 | Pinned extra tools (lasso, laser, frame, bucket fill, draw to shape). |
| 0.5.0 | Dark interface in light mode + panel color (§8). |
| 0.6.0 | Drag-to-reorder swatches (◀ removed), export/import with validation. |
| 0.6.1 | Pinned buttons wait for config before appearing (§7.11); this document. |
| 0.6.2 | Public release prep: first-install defaults are now stock Excalidraw (were the author's personal setup); doc made impersonal. |

---

## 13. Known gaps and ideas

- Some dialogs (export, help) may stay light under "dark interface": Excalidraw styles parts of them without `theme--dark` rules.
- Mobile/narrow layout uses a different toolbar; toolbar features don't apply there.
- Only `https://excalidraw.com/*` (not Excalidraw+, not the Obsidian plugin, not self-hosted forks). Adding a domain = add it to both `matches`.
- Native "Insert image", "Web Embed", "Text to diagram", "Mermaid", "Wireframe to code" are not pinnable (actions or dialogs, not plain tools). Adding one: verify its `activeTool.type` by clicking it (§9.4), copy its SVG, add to `EXTRAS`.
- Native tool buttons always show Excalidraw's default letter hint even if remapped (React owns them).
- Idea: a health panel on the settings page (toolbar found / App found / dark CSS rules found), reported by page.js with the tool list, so breakage is visible without DevTools.
- Idea: put the folder in a git repo; updates become `git pull` + reload.
