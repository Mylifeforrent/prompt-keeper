# Prompt Keeper · High-Fidelity Pages

A standalone, zero-build high-fidelity page prototype. It mirrors the main project's six workspaces with the same demo data and brings information density, hierarchy, interaction states, and responsive behavior close to a deliverable visual spec.

Compared with the React prototype under the main project's `src/`, this version does not depend on Vite / React / Tailwind: it is just `index.html + styles.css + data.js + app.js`. Double-click to open it, and it also works as a standalone attachment for design reviews, screenshots, or handoff notes.

## Opening

```bash
# Option 1: open directly
open index.html

# Option 2: local static server (recommended; clipboard and font behavior closer to a real browser)
cd high-fidelity
python3 -m http.server 4173
# http://127.0.0.1:4173/
```

No dependencies to install, no external font requests; system fonts use SF Pro / PingFang SC on macOS and fall back to Segoe UI / system sans-serif elsewhere.

Optional parameters:

- `?theme=dark` / `?theme=light` / `?theme=system`: set the initial theme, useful for screenshots.
- `#prompts`, `#instructions`, `#skills`, `#mcp`, `#sync`, `#settings`: jump straight to a workspace.

## Pages and interaction scope

| Workspace | High-fidelity page content | Directly operable interactions |
| --- | --- | --- |
| **Prompts** | Nested folder tree, card/table views grouped by folder, tag and favorite filters, Prompt details, System / User content, variables, repository path, sync status | Select, search, sort, tag filtering, favorite/pin, new, edit, copy (variable form), AI test drawer, version history, sync scope, delete confirmation; the Platform Discovery page supports preview / copy / save locally |
| **Agent Instructions** | Contract library (folder tree + contract details + target projection status), Resolution preview, project projection records, global dispatch matrix | Switch contracts, copy body, edit, versions, sync scope, match chain and compiled files after target/path switches, global directory path override / restore default, select instructions and tools, write preview, confirm overwrites individually |
| **Skills** | My Skills (folder tree + grouped cards), skill details, platform dispatch, Skill Store | Search, folder filtering, detail overlay, content/platform tabs, install/remove platform, store source and category filters, three-step install review wizard |
| **MCP** | My Library (folder tree + master-detail + redacted config + health check + dispatch status), Agent MCP reverse import, MCP Store | Enable/disable, favorite, tab switching, copy redacted config, personal notes, store install review, reverse import from external Agent entries, write preview when applying to platforms |
| **Sync Center** | Repository overview, policies for the four asset types, directory-structure terminal panel, blocked warning, stat cards, Agent status, recent syncs, change list, dispatch matrix, full history | Fetch now, push dialog, change-type filter, preview and accept (review checkbox required), three-way conflict comparison and strategy selection, plaintext credential handling, dispatch matrix cells, bulk sync of stale items |
| **Settings** | Appearance, Sync policy, Repository layout, Agent global directories, Data, About | Light / Dark / System, global directory path display, reset demo data |

## Design system

### Visual direction

- High-density desktop workspace, close to a Minimalism / Swiss dashboard: restrained decoration, strong hierarchy, thin borders, low-saturation surfaces.
- The primary color follows the main project's indigo `#4F46E5`; success / warning / danger / info each have their own token, with no hard-coded hex values.
- Light and dark themes driven by the same semantic tokens for background, cards, text, borders, states, and shadows.
- All structural icons are inline SVG (Lucide style, consistent stroke); emoji in skill cards come from demo data and are content, not structural icons.

### Key tokens

```css
--primary: #4f46e5;      /* indigo 600 */
--primary-soft: #eef0ff;
--bg: #f5f6fb;
--card: #ffffff;
--border: #e5e8ef;
--fg: #0e1525;
--muted-fg: #667085;
--success / --warning / --danger / --info

[data-theme="dark"] {
  --bg: #090f1a;
  --card: #111a2b;
  --primary: #7d7aff;
  --border: #22314a;
}
```

### Typography and density

- Base font size 13.5px; body 12px, auxiliary text 9.5–11px, code 9–10.5px; tabular-nums keeps numbers aligned.
- Main layout: sidebar 232px + folder tree 236px + list 404px + adaptive detail; top bar 60px.
- Spacing is mostly 4/6/8/10/14px, card radius 11px, panel radius 13–17px.
- Breakpoints:
  - `≤1440`: narrower folder tree/list.
  - `≤1280`: sidebar narrows to 212px, policy cards in two columns.
  - `≤1120`: sidebar becomes a 64px icon rail, folder tree hidden.
  - `≤900`: list fills the width, detail opens as a full-screen sheet; compiled preview single column.
  - `≤760`: sidebar 56px, compact top bar, list/detail single column, full-width overlays.
  - `≤420`: detail action buttons in two columns.
- Motion: page fade-in, 26ms card cascade, drawer/overlay 0.2–0.25s curves; everything collapses under `prefers-reduced-motion`.

### Accessibility

- All structural buttons have readable names or `aria-label`; states use `aria-pressed` / `aria-checked` / `role="switch"`.
- Keyboard: `/` focuses search, `N` creates a Prompt / contract, `Esc` closes overlays or returns to the list; overlays implement a Tab loop.
- The focus ring is a consistent 2px primary outline; contrast is verified in both light and dark themes.
- Overlays use a scrim + blurred backdrop; toasts use `aria-live`.

## Data and simulation boundaries

Demo data comes from the main project's `src/data/seed.ts`, `syncSeed.ts`, `contractSeed.ts`, `contractTargets.ts`, and `globalTargets.ts`, with extra fields for high-fidelity display:

- All data is local mock data and contains no real credentials; MCP credentials are always displayed as `[REDACTED]`.
- Git fetch / push / conflict resolution / project projection / global dispatch / AI test are all simulated in the front end; no real Git, file system, or model is accessed.
- Edit, create, favorite, review, and similar actions only modify current page memory; refreshing restores the seed data.
- Theme and card/table view preferences are stored in `localStorage` (`pk_hifi_theme`, `pk_hifi_prompt_view`).
- "Copy" prefers the Clipboard API and falls back to a hidden textarea + `execCommand`; the usage count only increments on success.

## Acceptance record

Checked page by page in Chrome at 1512×982, 1024×768, 768×1024, and 375×812:

- All six workspaces load with no horizontal scroll overflow, no console errors / uncaught exceptions.
- Light, dark, and system themes all work; a single click on the theme button toggles only once.
- Prompts: select / new / edit / filter / AI test / copy with variables / versions / delete flows work.
- Agent Instructions: switching the preview target updates the match chain, skip reasons, compiled file count, and paths in sync; global dispatch paths can be overridden / restored.
- Skills: the three-step store wizard completes installation and returns to My Skills.
- MCP: Agent MCP reverse import and store install review can be completed; redacted config, health check, and dispatch status can be toggled.
- Sync: the review checkbox controls the accept button; conflict strategies can be switched and reduce the list; dispatch matrix cells open cell details.
- Mobile: tapping a card opens the detail as a full-screen sheet; the back button and scrolling behave correctly.

## File structure

```text
high-fidelity/
  index.html    Page shell, inline SVG icon sprite
  styles.css    Design tokens, layout, components, light/dark themes, responsive rules
  data.js       Prompt / contract / Skill / MCP / sync demo data
  app.js        Rendering, routing, state, overlays, forms, and interactions
  README.md     This document
```

Interaction design background and product rules: main project [`docs/interaction-design.md`](../docs/interaction-design.md) and [`README.md`](../README.md).
