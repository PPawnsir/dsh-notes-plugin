**English** | [中文](README.md)

<div align="center">

# 📝 dsh-notes-plugin

**Turn the decisions and conventions that agent sessions would otherwise "lose the moment the chat ends" into local Markdown notes**

Auto-injected into the system prompt · Dispatch todos to live sessions · One-click selection capture · Pure local Markdown, never uploaded

[![npm version](https://img.shields.io/npm/v/dsh-notes-plugin.svg)](https://www.npmjs.com/package/dsh-notes-plugin)
[![npm downloads](https://img.shields.io/npm/dw/dsh-notes-plugin.svg)](https://www.npmjs.com/package/dsh-notes-plugin)
[![node](https://img.shields.io/node/v/dsh-notes-plugin.svg)](https://www.npmjs.com/package/dsh-notes-plugin)
[![license](https://img.shields.io/npm/l/dsh-notes-plugin.svg)](https://github.com/PPawnsir/dsh-notes-plugin/blob/main/LICENSE)
![category](https://img.shields.io/badge/awesome--dsh--plugin-workflow-blue)

<img src="packages/dsh-notes-plugin/docs/screenshot-panel.png" alt="dsh-notes-plugin notes panel" width="820">

**Interactive demo** <br>
<img src="packages/dsh-notes-plugin/docs/demo.gif" alt="dsh-notes-plugin interactive demo" width="820">

</div>

## Version Compatibility (dsh-notes ↔ DSH)

DSH evolves quickly and each plugin version differs in capability and supported range — **check the table below before upgrading the plugin**. The declared range comes from `peerDependencies` (enforced by npm at install time); the "tested baseline" is the DSH version on which that plugin version was developed and regression-tested:

| Plugin version | Released | Declared DSH range | Tested baseline | Highlights |
| --- | --- | --- | --- | --- |
| **0.3.3** | 2026-10-04 | `^0.1.7 \| 0.2.0-rc.2 \| ^0.2.0` | **0.2.0-rc.2** | Agent memory r3 lane model (convention/memory parallel lanes — enabling no longer asks for overlap-conflict confirmation) + injection manager panel (library-wide injection three-state overview + per-row direct edit + multi-select batch) + settings card interaction feedback (permanent ✕ close + dirty save/revert + fallback flush on close) + internal modularization refactor (client 46 slices / app 40 slices / host dual manifests 45 slice entries, dual-package same-source assemblers byte-equivalent + zero-BOM assertion on the publish surface) + `check --only` section-scoped regression; peer declaration unchanged |
| 0.3.2 | 2026-10-03 | `^0.1.7 \| 0.2.0-rc.2 \| ^0.2.0` | 0.2.0-rc.2 | Pure README re-release (remedy for the 0.3.1 release accident where the README was not synced: filled in missing descriptions for version history / token statistics / nested folders and more), zero code changes |
| 0.3.1 | 2026-10-03 | `^0.1.7 \| 0.2.0-rc.2 \| ^0.2.0` | 0.2.0-rc.2 | Agent memory v0 (kind=log work-log sedimentation + memory-guide onboarding + log hygiene) + snapshot version history + token consumption statistics + virtual folder nesting (maxFolderDepth / recursive subtree / cascade delete) + trash batch & multi-select delete + list resilience; the npm-page README stayed on the 0.3.0 list (remedied in 0.3.2) |
| 0.3.0 | 2026-10-02 | `^0.1.7 \| 0.2.0-rc.2 \| ^0.2.0` | 0.2.0-rc.2 | Major release: dual-mode editor (source ⇄ rich text) + image support + ✨AI organize + explicit archive (preview/undo) + sensitive masking + injection enhancements (staleness/budget/previewer) + trash + usage telemetry + wiki-links/backlinks + single-file export + organize suggester + filter center (~20 items, see the feature list); peer declaration kept unchanged (upper bound `^0.2.0`, conservatively not opening 0.3.x — unverified) |
| 0.2.4 | 2026-09-30 | `^0.1.7 \| 0.2.0-rc.2 \| ^0.2.0` | 0.2.0-rc.2 | DSH 0.2.0 compatibility: the declaration explicitly covers the 0.2.0-rc.2 prerelease (semver prereleases do not match wide ranges and must be enumerated); rename-race guard against body loss; verified loading on a local 0.2.0-rc.2 |
| 0.2.3 | 2026-09-30 | `>=0.1.7 <0.2.0-0` | 0.1.7 | npm page README synced with the repo root (sync-pkg-readme + docs whitelisted) |
| 0.2.2 | 2026-09-30 | `>=0.1.7 <0.2.0-0` | 0.1.7 | Declared range correction: lower bound tightened to the tested baseline 0.1.7 (0.1.5~0.1.6 dispatch list timed out in practice, and 0.2.1 still wrongly declared the old range) |
| 0.2.1 | 2026-09-30 | `>=0.1.5-rc.1 <0.2.0-0` | 0.1.7 | Context injection dual roles (convention/reference) / injection scope drops the workspace dimension (defaults to all sessions) / entry button & color v2 polish |
| 0.2.0 | 2026-09-29 | `>=0.1.5-rc.1 <0.2.0-0` | 0.1.7 | Virtual folders / UI v2 / catalog index injection / import & export / `/dsh-notes-app` / 0.1.7 dispatch performance fix |
| 0.1.2 | 2026-09-25 | `>=0.1.5-rc.1 <0.2.0-0` | 0.1.5~0.1.6 | Basic panel: CRUD / quick capture / dispatch / convention injection / search |
| 0.1.0 | 2026-09-23 | `>=0.1.5-rc.1 <0.2.0-0` | 0.1.5-rc | First npm release |

- **Recommendation**: always use the latest plugin version + a DSH at or above the table's "tested baseline"; below the baseline the RPC surface is not guaranteed complete (e.g. <0.1.7 has the dispatch-list timeout problem — 0.2.0 ships a mitigation, but behavior follows 0.1.7).
- **semver prerelease note**: a prerelease like `0.2.0-rc.2` **does not match** a wide range like `>=0.1.7 <0.3.0-0` (semver rules), so prerelease branches must be enumerated explicitly in the declaration — done this way since 0.2.4.
- When DSH makes a major change (`0.x` minor-version jump), this table is updated after the corresponding plugin adaptation release; the `peerDependencies` upper bound (currently `<0.3.0-0`/`^0.2.0`) is the conservative "not yet verified on the newer DSH" declaration, and lifting it happens with a new plugin release.

## What Problem It Solves

Conclusions inside agent sessions are disposable: why a design was chosen, which hard conventions a project has, the todo that popped up this afternoon — all scattered across the conversation stream. Compress the context or close the session, and that knowledge is gone. The next session's agent doesn't know what was decided last week, and the user has to repeat conventions over and over.

dsh-notes turns this into an accumulable local asset:

| Problem | Solution |
| --- | --- |
| Conclusions vanish when the chat ends | Press `Enter` in the panel to store a local Markdown note (`~/.dsh/notes`); one-click capture for selected text; never leaves your machine |
| Notes get messier as they grow | An LLM asynchronously infers the topic and backfills title/category; two orthogonal dimensions — `kind` (note/decision/todo/link/quote) and `status` (active/pinned/resolved/superseded) — plus virtual folders for filing |
| Agents don't know your conventions and reference material | A three-state segmented control in the detail area — "⚡ Off / Convention / Reference": convention = behavioral rules that must be followed, reference = factual background material (agents pull it on demand); note content is injected into the agent system prompt bucketed by role (`order 130`); scope defaults to all sessions and can be limited to specific sessions |
| Agents don't know what's in the library | Catalog index injection (`order 131`): a one-line-per-note catalog plus a gentle planning nudge goes into the system prompt, so the agent senses the inventory without searching; `note_get` fetches the full text of relevant entries, `note_search` finds more |
| Todos never get executed | One click dispatches a todo to any **live** session (`Agent.send` injects "recall context + concrete instructions" and wakes the target to start work); dispatch history can be marked done |
| Can't find it afterwards | Instant panel search + full-text fallback union search, the `note_search` tool filters by tag/topic/kind, archive merges by session or tag, soft delete is restorable |

## Design Philosophy: The Note Network

dsh-notes is not just "a notes plugin with a panel" — the whole product is **a continuously growing network of note references**: nodes = notes (memory / reference / log / archive / index / todo…), edges = references. Features change endlessly, but their carrier is always a node on this network; every governance surface is a node, and high-frequency writes always land in root notes. Every new feature must first pass the design question: **What are its nodes? What are its edges?** (nodes first, then edges)

The four kinds of edges in the network:

| Edge | Form | Semantics |
| --- | --- | --- |
| Wiki link | `[[id]]` in the body | Evidence (log → memory) / association |
| Soft link | front-matter field (`schedule.runLog`, `refNote`) | Association (companion note points to its host) |
| Index mount | Injection-index §1 line `- [[id]] 何时查我：…` | Mount (index → reference; the primary recall channel) |
| Dispatch mount | `dispatches[].sessionId` | Recall (task → reference = deterministic distribution) |

**Root-index pattern**: machine-produced artifacts never add a new panel or a new store — data concentrates in linked companion notes (the RootNote hosted-section framework: anchor section / line format / idempotence / tail trimming; the machine only performs line-level edits inside the section, zero touches outside it). Four instances: scheduled-dispatch execution log, memory archive, recall metrics (injection index §2), and the injection index. The original body is never touched — a convention's body is the dispatch payload; history always goes into the companion note.

**Memory governance tiers** (recall guarantee grading): `inject` full-text injection = strong guarantee; task mount (one whenToUse line in index §1) = medium guarantee · the primary channel; the catalog index (one recall line per note) = weak guarantee. Reference notes are not injected by default — mounting is an explicit action.

**Red lines**: the convention bucket is injected verbatim and untouched; reference notes are not injected by default (mounting opts in explicitly); archive/metrics root notes are never injected (no recursion); work logs are stealth by default, exempted only by directed actions such as expanding the log folder / archive / metrics.

## Install

> Host requirements: Node ≥ 22; DSH ≥ `0.1.5-rc.1` (declared via `peerDependencies`; see package.json for the version range including prerelease branches)

```sh
dsh plugin --profile web add dsh-notes-plugin
```

Takes effect after restarting DSH: a "**Smart Notes**" button (✎, with a count badge) appears in the session header — click to open/close the panel; there is also a draggable floating bubble entry in the corner of the desktop.

## Upgrade / Uninstall

```sh
dsh plugin --profile web add dsh-notes-plugin@latest   # upgrade (restart DSH)
dsh plugin --profile web remove dsh-notes-plugin       # uninstall (data is kept)
```

## Feature List

- **Quick capture**: the top-bar `＋` icon (or `Alt+N`) expands the input box — `Enter` saves, `Shift+Enter` inserts a newline; an LLM asynchronously infers the topic and backfills the title without blocking interaction
- **Selection capture**: select any text on the page and a floating "quick capture" button appears — one click stores it as a `quote` note (you can also write a "remark" in the same popover and let the LLM extract tags/kind/injection intent)
- **Same-session merge**: consecutive quick captures within a 10-minute window are auto-merged by timestamp into one note, avoiding fragmentation
- **Kind & status**: `kind` = note / decision / todo / link / quote; `status` = active / pinned / resolved / superseded (pinned notes are grouped separately, resolved notes are dimmed)
- **Virtual folders (nestable)**: the sidebar note tree is organized as "📌 Pinned / 📁 Folder tree / Unfiled notes"; folders nest (right-click "New subfolder" or drag to re-parent; depth cap `maxFolderDepth` defaults to 3 levels, adjustable / 0 = unlimited, cycles auto-rejected); folder views and counts use the **recursive subtree** caliber (clicking a parent folder shows all descendant content); deleting a folder deletes its children with it (the confirm states "N subfolders + M notes move to the trash (restorable); the folder structure is not restorable", and restored notes whose original folder no longer exists fall back to unfiled); right-click offers rename / move up-down (swap among siblings) / move back to root; the manifest persists in `folders.json` (`parent` field, zero migration for existing data), selection state in `localStorage`
- **Snapshot version history**: before every save, the previous version is auto-snapshotted into `.history/<id>/` (tiered retention: every version within 1 hour / hourly for the current day / daily within 7 days; 20-version cap per note + a global 50MB LRU); the detail area's "History" panel lists versions (time/bytes), opens read-only previews, and restores with one click — the current version is auto-snapshotted before restoring, **so a restore is itself undoable** (just roll back again)
- **Panel UI v2**: two-column layout — left note tree (pinned / folders / unfiled grouped by topic; the "topic filter" applies globally across folders), right full-width editor (title + topic/tags/kind/status meta chips editable in place); SVG icon library + DSH design-token colors, light/dark theme adaptive; quick capture card v2 (selection preview + copy/save/cancel — a successful copy closes the card)
- **Bilingual UI (Chinese / English)**: the settings card "Language" row switches the UI between 中文 and English (persisted in localStorage, Chinese by default, full re-render on switch); runtime flat dictionaries `src/i18n/zh.js` + `en.js` (single source shared by both client states) with `t(key, { name })` interpolation — a missing key falls back to the Chinese original and never leaks a raw key; check.js runs a resident i18n guard (zh/en key-set equality + duplicate-key defense + two-way dictionary↔code reference coverage + product dictionary spot checks) and prints an advisory "uncovered list" of remaining inline-Chinese files at the report tail (non-blocking); host-side RPC error messages stay Chinese in this release
- **Context injection (dual roles)**: the detail area's three-state segmented control "⚡ Off / Convention / Reference" (independent fields `inject` + `injectRole`, not tag-based) — convention = behavioral rules that must be followed (injected into the "user conventions" bucket every turn), reference = factual background material (the "reference material" bucket, pulled on demand when relevant to the current task); the scope popover is multi-select — inject into all sessions by default, tick specific sessions to restrict to them (sessions grouped by workspace and shown by name; sub-agents and archived sessions auto-excluded)
- **Catalog index injection (recall channel)**: a lightweight channel beside full-note injection — a one-line-per-entry catalog (`- [id] title (kind, topic)`) auto-injects into the system prompt (`order 131`, right after conventions) with a gentle planning nudge, so the agent knows the inventory at planning time; settled notes (resolved/superseded) and notes already hit by full injection are auto-excluded, capped at 40 entries; a single note opts out of the catalog via front-matter `recall: false`, and the settings card master switch (`catalogEnabled`) turns it all off
- **Injection manager panel**: settings card "Injection Manager → Manage…" — a library-wide injection three-state overview (convention N / reference M / not-injected K stat chips that filter on click + 250ms debounced search); per-row three-state segmented direct edit (semantics exactly identical to the detail-area control); multi-select batch "Set as convention / Set as reference / Turn off injection" (confirm-gated, per-item failure counting does not interrupt); injecting entries first (convention > reference), sorted by update time descending within groups; logs are stealth-hard-forbidden (three-state control disabled + not batch-selectable), sensitive-note rows hint that injection auto-masks, and an ever-injected badge shows the sticky flag
- **Settings card interaction feedback**: a permanent ✕ close in the title bar + dirty-state "Save" (explicit confirmation: all numeric fields are validated first, then only keys whose "control value ≠ persisted value" are written serially) / "Revert" (rolls back to the snapshot taken on open); closing via ✕/Esc/mask click with unpersisted changes auto-flushes as a fallback and confirms via toast; the existing save-on-select / save-on-blur auto-save is unchanged
- **Task dispatch**: one click dispatches a todo to a live session or a new session, with optional concrete instructions; dispatch records (session name/instructions/time/done) live in the note's `dispatches` field without polluting the body; the target session's system prompt keeps injecting the todo until it is marked done; DSH 0.1.7 adaptation — the live-session list goes through the session metadata cache (on a miss it returns a placeholder + `titlesPending`, and the frontend polls every 1.5s to fill in), cutting load time from 128s to 0.2s
- **Scheduled dispatch (a convention is a schedule)**: a `contractType: dispatch-schedule` convention note + a structured front-matter `schedule` declaration (`{at|every, target, action, enabled, anchor?, dow?}` — natural-language parsing is forbidden) — the host runs a resident 30s cron tick (`unref` so it never holds the process, reload-safe against double runs, catch-up evaluation on startup), and when due it reuses the full dispatch pipeline to auto-dispatch (the dispatch card's source is labeled "Scheduled @title", and receipts close the loop through the existing chain); three-layer state = front-matter `schedule.lastFiredAt/lastRun/lastError` (machine read/write) + the existing `dispatches` history array; **independent run-log note (runLog soft link)**: on the first receipt a "Scheduled @title · Run Log" note is lazily created (kind=note, visible and searchable, folder/topic follow the convention), the convention's front-matter `schedule.runLog` stores its id as a soft link, and the detail plan block shows a "Run log ↗" jump — the convention body is never touched (the body is the dispatch payload; appending history would pollute the next dispatch context), entries newest-first trimmed to ≤50, idempotent dedupe by msgId, and deleting the convention does not cascade-delete the run log (kept for the record); the idempotency lifeline = `lastFiredAt` is persisted before dispatching — a one-shot `at` missed while stopped fires once on startup, a missed recurring tick aligns to the next cycle without catching up; anchored time (recurring mode optionally takes `anchor: 'HH:MM'` local time + weekly `dow: 0-6`): first fire = the next local anchor time, and the firing sequence is pinned to that time of day without drifting from creation/fire times — existing declarations without `anchor` keep pure-interval semantics (zero migration); write red lines: `at` must be in the future / recurring interval ≥5min / `anchor` strictly HH:MM and requires a whole-day interval / `dow` 0-6 and weekly only / target session alive / `runLog` must be an existing note id or empty / unknown fields rejected
- **Search**: the panel search box (instant local filtering + 250ms debounced full-text fallback, unioned), the filter center (a "Filter(N)" button + grouped popover — the status group pinned/injected/ever-injected/sensitive and the kind group of five kinds are all multi-select, OR within a group and AND across groups, active-condition chips individually removable, ever-injected feature-detected via the slim field; an independent sort control time/references/relevance, conditions and sort persist), and the `note_search` tool
- **Keyboard flow**: `Ctrl+K` search (`↓` inside the box jumps straight to the first hit in the list, keeping the filter context), `Alt+N` new note (`Ctrl+N` is the browser-reserved "new window" key and has been dropped), `j/k`/`↑↓` move the focused row (visible highlight), `Enter` opens, `Esc` layers (close popover → clear search and refocus the list → close the panel); typing in inputs never gets hijacked; same behavior in the floating panel and the full-window page (`/dsh-notes-app`)
- **Explicit archive**: the title-bar "Archive" first runs a dry-run preview (`notes-archive-preview`, with an onboarding bubble), and quick-capture groups merge only after you tick them (`notes-archive` whitelisted groups — the host fully validates before acting; the toast can undo once via `notes-archive-undo`); manual notes are excluded from auto-grouping (mis-merge protection) — use the list's "Select" multi-select to merge them; original notes are soft-deleted (`.bak` backup) and restorable
- **Organize suggester**: settings card "Organize Suggestions" — `notes-suggest` dry-run, zero writes, nominates four candidate classes: quick-capture archive groups / stale unreferenced (kind=note/link older than `staleDays` and never hit by `note_get`) / orphan notes (ordinary notes with no `[[wiki-link]]` outlinks or backlinks, not injected, zero references) / log hygiene (agent memory v0: weekly aggregation beyond 7 days + monthly aggregation beyond 90 days); it only nominates, never executes — jump straight to archive preview / batch soft-delete (no confirm, toast-undoable) / orphans are display-only with per-item jumps / log hygiene only expands details
- **Agent memory v0 (work-log sedimentation, r3 lane model)**: the settings card "Agent Memory" section "Enable sedimentation guide" — creates a prefilled convention note (`inject=true`, `contractType: memory-guide` contract identity marker (with `tag memory-guide` as a compatible discovery key), three scope tiers), guiding agents to write session conclusions as `kind=log` work logs when a task wraps up or when you say "jot down today's work" (four-section template: what was done / changes / leftovers & follow-ups / linked notes); the lane model: agent memory is a parallel lane independent of note conventions — conventions govern how you take notes (for humans to read), memory governs what the agent sediments for itself (self-recall); both may apply to the same event with no overlap check / conflict confirmation; logs produced while the guide is active get `origin: memory-guide` in front-matter for provenance; logs are stealth by default — `inject` hard-off, excluded from the catalog by default, absent from default lists and default search (the filter center's "log" kind is the dedicated entry), and never nominated by stale/orphan cleanup; out-of-window old logs are nominated for aggregation by workspace×week/month in the suggester's "log hygiene" section (nominate only, window adjustable in the settings card); disabling = turning off that convention's injection (spec: `design/agent-memory-v0.md`)
- **Dual-mode editor (source ⇄ rich text)**: toggle via the two-segment switch on the meta row or `Ctrl+/` — rich text is a restricted WYSIWYG (whitelist: h1-h3 / lists / quotes / fenced code blocks / bold-italic / inline code / links (http/https only) / images / wiki-links; render ⇄ serialize round-trips losslessly, writing back to source with a 900ms debounce); rich-text toolbar (bold/italic/link/image) + paste-HTML whitelist sanitizing (h4-6 demoted to paragraphs, script/style dropped); when the body contains syntax outside the whitelist, the rich-text entry is greyed out with a banner explaining why, and recovers once cleaned
- **Relaxed rich-text gate**: inline HTML (`<b>`/`<i>` etc.) renders literally, GFM tables render read-only (`contenteditable=false` atomic islands, serialized back verbatim) — no more whole-document downgrade; only ambiguous structures like multi-line HTML blocks / nested quotes disable rich text
- **✨ Organize (AI rewrite by template)**: the "Organize" button on the editor meta row — the current draft goes through `notes-ai-organize` (the same LLM channel as `notes-quick-instruct`) and is structurally rewritten per `kind` template (decision → background/conclusion/rationale, todo → checkboxes, link → link/description, quote → quote block/source, machine/ops info → environment/machine list/accounts/portals); after replacement it flows through auto-save, and the toast can undo once; bodies over 12000 characters error out with guidance to split
- **Kind template skeletons**: new notes are prefilled per kind (same templates as above; `note` is free-form empty) — the panel's new-note modal lets you pick a kind, and the full-window page follows the filter center's kind group (prefills with that kind when exactly one is selected)
- **Image support**: bodies reference `![](assets/xxx)` relative paths (files land in `assets/`), with three upload entries — paste / drag-drop / toolbar button (`notes-asset-upload`: mime whitelist png/jpeg/gif/webp, ≤5MB; `GET /dsh-notes/asset` serves `<img>` loads, path-traversal-proof); PNG/JPEG over 1MB are downgraded client-side on a canvas to JPEG before upload (long edge ≤2560px, quality ladder 0.85→0.45, transparent backgrounds painted white; GIF/WebP untouched to preserve animation/transparency), and the upload dialog shows "compressed: before → after"; archive backups and import/export carry assets along
- **Asset cleanup**: settings card "Asset Cleanup" — `notes-assets-prune` scans `assets/` for orphan files not referenced by any note body (references from deleted notes still count as protected — better keep than delete), and deletes only after you tick them in the dry-run preview; the published static package performs real deletion, while the dev build clears placeholders (0-byte tombstones)
- **Trash**: the sidebar-bottom "Trash" (same entry in the panel and the full-window page) — lists soft-deleted notes (`notes-list` parameterized `includeDeleted`), supporting **select-all/multi-select + batch restore / batch permanent delete** (the confirm states "not recoverable (including version history)", with re-entry protection while running); click a title for an inline **read-only body preview** (Markdown rendered, zero injection surface); per-item "Restore" (`notes-restore`) or "Permanently delete" (`notes-purge`, double-confirm "permanent deletion is not recoverable"); permanent deletion is limited to already-soft-deleted notes (host safety gate), and removes the `.md`, the archive backup `.md.bak`, and the `.history/<id>` snapshot history together — the published static package performs real deletion, the dev build clears placeholders (0-byte tombstones, treated as nonexistent across the whole chain)
- **Multi-select batch operations**: the list's "Select" enters multi-select mode with a bottom action bar "N selected | Merge | Delete | Cancel" — merge goes through archive preview, delete soft-deletes into the trash (no confirm, toast-undoable; confirmation strength = irrecoverability: soft delete is light-confirm, permanent delete keeps the double confirm), buttons disabled at 0 selections
- **Sensitive note masking**: a 🔒 toggle on the editor meta row (`sensitive=true`) — when injected into the system prompt, the body is masked line by line (keys and structure kept, values hidden as `******（敏感，note_get <id> 获取）`, so the agent must `note_get` for the original; catalog injection masks the title likewise and adds a 🔒 mark); password/secret patterns are auto-detected — quick captures land directly as `sensitive=true`, manual creates return a `sensitiveSuggested` hint (not enforced)
- **Injection enhancements**: staleness decay reminders (catalog rows append ⚠ to note/link entries not updated for more than `staleDays` (default 90 days, 0 = off)) + injection size budget (`injectBudgetChars` character budget, truncated with an annotation when exceeded) + the settings card "Injection Preview" (`notes-inject-preview` renders the injection product in real time + masking/staleness/truncation stats, three perspectives: global default / workspace union / single-session filter) + the `injectEver` ever-injected sticky flag (only rises, never unset — drives the filter center's "ever injected" and list-row badges)
- **Wiki-links & backlinks**: `[[id or title]]` links in the body (exact id match first, then exact title match across the library, unresolved stays plain text) — wiki-link marks at list-row ends, click-to-jump to the target note inside rich text, and a "Backlinks" panel in the detail area listing every other entry in the library pointing to the current note (lazy library-wide index, shows "indexing…" while cold)
- **Import / Export**: entries in the settings card "Data" section — a full-library directory snapshot (including `folders.json`, not packed or compressed — the directory *is* the format; `.history` version history is excluded by default, pass `includeHistory: true` to the `notes-export` RPC to include it); "Export single file…" concatenates notes by scope (all/folder/tag) into one self-contained Markdown (each piece = title + metadata block + body, optional table of contents, images inlined as base64, directly shareable; a single file over 20MB warns but still exports); import is two-step: preview first (new/same/different classification + folder merge stats) then execute — conflicts with different content are skipped by default and overwritten only when ticked; auto-backup before executing (including `.history`), add/modify only, never delete; imported `.history` merges only along with notes that are new to the library (same-id conflicts skip history merging, so the two libraries' histories never mix)
- **Token usage statistics**: the settings card "Usage" section — real usage metadata metering on the LLM channel (StreamChunk `usage` field, falling back to character estimation marked "approx." when metadata is absent), current-month usage / all-time total / `usageBudgetMonthly` monthly budget reminders (tiered toasts when approaching and exceeding); stats land in `usage.json`, RPC `notes-usage-get`
- **Apple Notes feel**: zero-radius list items, plain-background selection, hover-only actions, auto-save (bottom hint "Auto-saved HH:MM"), dark mode adaptation
- **Semi-standalone app**: open `/dsh-notes-app` directly in the browser (same origin as DSH Web — just replace the path of the DSH page address with `/dsh-notes-app`) for the full-window notes page — the in-package `app.html` shares UI v2 and the same RPC data layer with the panel, so you can manage notes outside any session (capture / folders / dispatch / import & export / settings all available)
- **Performance**: in-memory cache (writes backfill synchronously, list hits read zero disk) + on-demand body loading + lazy pagination (50 per screen); panel position/size/column widths persist to `localStorage`
- **Modular engineering structure (for developers)**: the single source of truth for all three ends is sliced by domain — client 46 slices / app 40 slices / host dual manifests 47 slice entries (manifests concatenate in order byte-for-byte, zero insertion and zero rewriting; 7 slices shared by both packages from a single source, divergent slices registered as `.dist.js` variants); `scripts/concat-*.cjs` dual-package same-source assemblers + `build-dist.cjs` refresh all four artifacts at once (`lib/client.js` + `lib/styles.css` + `app.html` + `index.mjs`); check enforces the modular structure contract (ordering / same-source / variant registration assertions) + a zero-BOM assertion on the publish surface (defends against the accident where DSH silently skips the plugin); `node check.js --only=39,42` runs section-scoped regression (the `CHECK_ONLY` environment variable works the same)

## Agent Tools (3)

| Tool | Purpose |
| --- | --- |
| `note_search` | Free-text + `tag` / `topic` / `kind` / `folder` filtered search (`folder` accepts a folder id or exact name, `""` = unfiled; returns a slim list — fetch bodies with `note_get`) |
| `note_get` | Read the full body + all metadata by id (including dispatch history) |
| `note_manage` | Single-entry CRUD + organize + dispatch + move: `create` / `list` / `update` / `move` / `delete` / `restore` / `archive` / `dispatch` |

`note_manage { action: 'move', id, folder }`: move a note into a virtual folder (`folder` accepts a folder id or exact name, `""` = move out to unfiled; an unknown folder errors out directly, never writing a dangling reference). Folder create/rename/delete/reorder itself is managed by the panel's `notes-folders` RPC.

`note_manage`'s `create` / `update` also accept `injectRole` (`'convention'` / `'reference'`, meaningful only with `inject: true`, defaults to `convention`): `convention` = behavioral rules that must be followed (the "user conventions" bucket), `reference` = factual background material (the "reference material" bucket, agents pull it on demand); suggested by `kind` — `decision`/`todo` → `convention`, `note`/`link`/`quote` → `reference`.

`note_manage`'s `create` / `update` also accept `recall` (boolean, default `true`): set `false` to move a note out of catalog index injection (still searchable via `note_search`), orthogonal to `inject` full-note injection.

`note_manage { action: 'dispatch', id, targetSessionId? }`: without `targetSessionId` it returns the current live-session list to choose from; with it, the todo is injected into the target session and the session is woken up to start work.

## Data Location

Notes are independent Markdown files under `~/.dsh/notes/` (YAML front-matter + body), **purely local, never uploaded**; uninstalling the plugin does not delete data.

```
~/.dsh/notes/
  n-xxxxxxxx.md        # one note = one file
  n-xxxxxxxx.md.bak    # backup on archive/overwrite
  .history/            # snapshot version history (auto-snapshots the previous version before each save; see "Version history")
    n-xxxxxxxx/        # one directory per note
      2026-09-17T06-02-34.123Z.ab1.cd2.md   # <UTC timestamp>.<content hash>.md (plain text, not compressed or encrypted)
  assets/              # image assets (base64 text on disk; bodies reference them as ![](assets/xxx) relative paths; orphan assets can be cleaned via "Settings → Asset cleanup")
  folders.json         # virtual folder manifest [{id, name, order}] (missing/corrupt falls back to an empty manifest without affecting the note main flow)
  settings.json        # panel settings (LLM model options, catalogEnabled catalog-injection master switch, staleDays staleness threshold, injectBudgetChars injection budget, etc.)
  perf-report.json     # panel performance telemetry (safe to delete anytime)
```

**Version history (snapshot-based)**: before every save lands on disk, the host auto-snapshots the replaced previous version into `.history/<note id>/` (aligned with the editor debounce — one real save = one snapshot; repeated saves without change are deduped by content hash and skipped). Retention policy: every version within 1 hour → hourly for the current day → daily within 7 days → evicted beyond 7 days; at most 20 versions per note; a global 50MB budget for the whole `.history` (oldest snapshots evicted across notes when exceeded). The trash's "Permanently delete" also wipes the note's entire history tree. History is a local safety net: export does **not** include `.history` by default (pass `includeHistory: true` to the `notes-export` RPC to include it), the pre-import auto-backup always includes history, and import merging carries history only for notes that are new to the library (same-id conflicts skip it — the two libraries' histories never mix).

On first startup, if the old dev-version notes directory (`<repo>/notes/`) is detected, missing files are **copied once** into `~/.dsh/notes` (copy only, nothing deleted, same-name skipped).

```yaml
---
id: n-xxxxxxxx
title: Title
topic: Topic            # auto-inferred by the LLM
workspace: workspace    # directory name of the session cwd
folder: ""             # virtual folder id (in the folders.json manifest); "" = unfiled
tags: tag1, tag2
kind: note             # note/decision/todo/link/quote
status: active         # active/pinned/resolved/superseded
inject: false          # whether to inject into the system prompt (injection is the context master switch)
injectRole: convention # injection role (persisted/effective only when inject=true): convention = behavioral rules that must be followed / reference = factual background material (agents pull on demand); defaults to convention
injectTo: []           # injection scope multi-select: [] = all sessions (default) / [session short-id,...] = only these sessions (legacy global/workspace values tolerated as all sessions)
recall: true           # whether to enter catalog index injection (false exits the catalog but stays searchable; orthogonal to inject)
injectEver: false      # ever-injected sticky flag (once inject was set true, stays true forever; read-only)
sensitive: false       # sensitive note (body masked line by line when injected)
useCount: 0            # usage telemetry (note_get hit count, persisted with 60s debounce)
createdAt: ISO-8601
updatedAt: ISO-8601
sessionId: source session
cwd: source working directory
contractType: ""        # contract typing ("" = ordinary note; dispatch-schedule = scheduled-dispatch convention; other values are managed by internal system flows)
schedule: {...}        # scheduled-dispatch declaration + machine state (persisted only when contractType=dispatch-schedule, single-line JSON: {at|every, target, action, enabled, anchor?, dow?, lastFiredAt?, lastRun?, lastError?, runLog?}; anchor='HH:MM' pins the local time, dow=0-6 weekday for weekly; runLog = soft link to the independent run-log note id, lazily created and written back on the first receipt)
dispatches: []         # dispatch history (session/instructions/time/done)
mergedFrom: []         # source ids merged by archive
archivedAt: ""
deleted: "false"       # soft-delete flag
---

Body Markdown
```

Backward compatibility: old files missing `inject`/`kind`/`status`/`injectRole`/`injectTo`/`folder`/`recall`/`sensitive`/`injectEver`/`useCount` fall back automatically (`folder` defaults to unfiled; `recall` defaults to true; `injectRole` defaults to `convention`; `sensitive`/`injectEver` default to false; `useCount` defaults to 0 — zero migration for existing notes; without `inject`, it falls back to detecting `convention` in `tags`). A `folder` pointing at an id outside the manifest (e.g. folders.json corrupted or externally mangled) is treated as unfiled, and deleting a folder actively clears the `folder` of its notes back to unfiled.

## Permissions & Implementation

- **Host side**: `inject: ['fs', 'sandboxPolicy']` — only notes read/write and write policy are needed; `llm` / `agents` / `systemPrompt` / `sessionPersistence` / `workspaceRegistry` are all fetched on demand via `ctx.get` + existence guards, degrading the corresponding feature when missing (e.g. no auto-classification without an LLM)
- **Client side**: `inject: ['slots']` — registers 4 Slot injection points: session header button (`conversation.session.header.actions`, order 40), floating bubble (`shell.overlay` 199), floating panel (200), selection capture (201)
- **Communication**: the client calls the host RPC via `fetch('/dsh-notes')` POST `{method, args}` (note CRUD / search / archive / dispatch / import & export / settings / `notes-folders` folder management + 1 liveness probe `notes-ping`); styles are delivered via `notes-css` and injected as a `<style>`, zero external runtime dependencies; the host also registers a `GET /dsh-notes-app` page route that directly returns the in-package `app.html` (text/html, non-GET/HEAD → 405)

## Source & Development

- Repository: <https://github.com/PPawnsir/dsh-notes-plugin>
- This package (`packages/dsh-notes-plugin/`) is generated from the dev-version modular sources: `index.mjs` is the host-side ESM static bundle (`src/host/**` concatenated per `manifest.dist.js` and written to disk), `lib/client.js` is mechanically transformed by `scripts/build-dist.cjs` from the `src/client/**` concatenation product (with transformation-count assertions that abort on any miss), and `app.html` is the `/dsh-notes-app` full-window notes page (`src/app/**` concatenation product; it shares the same UI/interaction with the `design/notes-ui-v2.html` prototype — only the data layer differs)
- Regression tests (in-memory mocks, real notes untouched):

```sh
node scripts/build-dist.cjs           # after changing src/** (client/host/app/shared/styles), refresh all four artifacts at once: lib/client.js + lib/styles.css + app.html + index.mjs
node --check packages/dsh-notes-plugin/index.mjs
node --check packages/dsh-notes-plugin/lib/client.js
node check.js                         # 780-case regression (host full chain + static package + client UI surface + virtual folders + catalog injection + import & export + semi-standalone page + dual-mode editor + sensitive masking + injection enhancements + telemetry/wiki-links + snapshot history engine + modular structure contract + bilingual README.en + i18n guard + note-network guard / README philosophy)
```

See [DEVELOPMENT.md](https://github.com/PPawnsir/dsh-notes-plugin/blob/main/DEVELOPMENT.md) for details.

## License

MIT
