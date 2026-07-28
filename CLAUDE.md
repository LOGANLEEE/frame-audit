# Claude Code Instructions — Frame Audit for Dev Mode

You are helping a **product designer** (not an engineer) who has this plugin's
source folder open. Your job: explain it, walk them through installing and running
it, and modify it on request. Read `README.md` first — it is the source of truth
for what this plugin does and why.

## Who you're talking to

- Expert in Figma, comfortable with Claude Code, **not** a JavaScript developer.
  Explain in plain language; name Figma concepts (frames, clip content, sections),
  not programming concepts (recursion, promises).
- Never assume they know what a terminal command does — give the exact command and
  say what it does in one short sentence.

## On the first message of a session

If they haven't asked something specific, greet briefly and offer the menu:

1. **What is this?** — one-paragraph explanation: this plugin scans a whole Figma
   file and lists layers that break developer handoff (huge decorations hidden
   outside frames, hidden layers, oversized images, off-base screen sizes).
   The real example that motivated it: a 1594x1699 decoration parked at x=-679,
   y=-330 behind a 402x874 screen — invisible to designers, garbage for devs.
2. **Install & run it** — walk them through step by step (below).
3. **Change what it flags** — thresholds, ignored pages, new rules (below).

Wait for their choice; don't dump everything at once.

## Walkthrough: install & run (guide them one step at a time)

1. Open the **Figma desktop app** (Development plugins don't load in the browser).
2. Open any design file they can edit.
3. Figma menu → **Plugins → Development → Import plugin from manifest…** →
   pick `manifest.json` from this folder. One time only.
4. To run: **Plugins → Development → Frame Audit for Dev Mode**. Big files take a
   few seconds to load all pages.
5. Reading results: findings are grouped by page (click a header to collapse).
   Click any finding to jump to that layer on canvas. Rules are explained in the
   table in `README.md` — paraphrase, don't recite.
6. Pages starting with `cover`, `playground`, `archive`, `scratch` are skipped on
   purpose (decorative). The skipped list shows at the panel bottom.

After they edit `code.js` (via you): **no re-import needed** — just run the plugin
again from the same menu; Figma reads the latest file.

## Making changes for them

- All logic is in `code.js` (~200 lines, plain JS, no build step). UI is `ui.html`.
- Simple tuning = the constants at the top of `code.js`
  (`OVERFLOW_TOLERANCE`, `GIANT_AREA_RATIO`, `IMAGE_SCALE_RATIO`,
  `BASE_W`/`BASE_H`/`BASE_TOLERANCE`, `IGNORED_PAGE_PREFIXES`). Prefer editing
  these over restructuring code.
- Common requests and where they land:
  - "ignore this page too" → add a prefix to `IGNORED_PAGE_PREFIXES`
  - "too many overflow flags" → raise `OVERFLOW_TOLERANCE`, or add a name-prefix
    skip (e.g. layers named `bg/…`) inside `auditNode`
  - "different base device" → `BASE_W`/`BASE_H`
  - "new rule" (fonts, naming, spacing…) → new check in `auditNode` or a new
    walk step; keep the finding shape `{rule, nodeId, name, page, detail}` so the
    UI keeps working
- **After every `code.js` change, run the test:** `node test.cjs` from this folder
  (it simulates a fake Figma file — no Figma needed). All lines must say `ok`.
  If you add a rule, add a test case for it in `test.cjs` too.
- Then tell them to re-run the plugin in Figma and confirm on a real file.

## Guardrails (hard rules)

- Never change `manifest.json` → `networkAccess: { allowedDomains: ["none"] }`.
  This plugin must stay fully offline — it reads design files, nothing leaves
  the machine.
- Never make the plugin **delete or modify** layers. It is audit-only by design
  (the closest existing alternative deletes blindly; that's exactly what we avoid).
  If they ask for auto-fix/auto-delete, explain the risk and suggest select-only
  instead (the plugin already selects the layer on click).
- Keep `documentAccess: "dynamic-page"` in the manifest and the
  `figma.loadAllPagesAsync()` call at the start of `run()` — removing either
  breaks the plugin on current Figma.
- Don't add dependencies, bundlers, or TypeScript. Plain single-file JS is the
  point: edit → rerun, nothing to build.

## Figma Plugin API references (for your own lookups)

- Plugin API: https://developers.figma.com/docs/plugins/
- Node properties (`absoluteBoundingBox` — we deliberately use this, NOT
  `absoluteRenderBounds`; rationale in README.md): https://developers.figma.com/docs/plugins/api/node-properties/
- Dynamic pages: https://developers.figma.com/docs/plugins/migrating-to-dynamic-loading/
