# Desktop Workspace Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the waterfall layout with a left-report / right preview+console Tab workspace for Electron and Vite.

**Architecture:** Keep existing panels (`UploadZone`, `ReportPanel`, `PreviewPane`, `ConsolePanel`). Rewire `App.tsx` into a CSS Grid workspace; add right-pane Tab state that hides Electron `WebContentsView` when Console is active. Compact upload styles; optional default window size bump.

**Tech Stack:** React 19, TypeScript, existing CSS variables, Electron IPC (`hidePreview` / `showPreview` / `updatePreviewBounds`).

## Global Constraints

- Do not change rule engine / markets / VFS / parser behavior.
- Spec: `docs/superpowers/specs/2026-08-07-desktop-workspace-layout-design.md`
- Layout: ≥900px left~42% / right~58%; &lt;900px stack (right on top).
- Console lives in right Tab only; unread dot when new logs arrive off-tab.

---

### Task 1: Workspace shell + CSS

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/ui/UploadZone.tsx`
- Modify: `electron/main.cjs`
- Modify: `README.md`

- [ ] Replace `.waterfall` markup with `.workspace` grid: `.pane-left` (upload + status + report) and `.pane-right` (tabs).
- [ ] Add styles for workspace, panes, right tabs, compact `.upload-zone.compact`.
- [ ] Pass compact class/prop to UploadZone; default BrowserWindow ~1200×800.
- [ ] Update README layout sentence.
- [ ] Verify: `npm run build` passes; visual structure exists (tabs can be stubbed briefly).

### Task 2: Right Tab + Electron preview visibility

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/ui/PreviewPane.tsx` (only if section head / nesting needs tweak)
- Modify: `src/ui/ConsolePanel.tsx` (fill height in tab)

- [ ] State `rightTab: 'preview' | 'console'`; unread badge on console tab.
- [ ] When `rightTab !== 'preview'`, call `hidePreview()`; when returning to preview with an active session, `showPreview(metrics)` + bounds sync.
- [ ] Mount PreviewPane only content under preview tab (or keep mounted but CSS-hidden — prefer keep mounted for iframe blob mode, hide Electron view via IPC).
- [ ] ConsolePanel under console tab, full height.
- [ ] Verify: `npm test`; `npm run build`.

### Task 3: Polish + accept

- [ ] Ensure left pane scrolls findings independently; right pane fills height.
- [ ] Narrow breakpoint stacks panes.
- [ ] Commit layout changes.

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Left upload + report | 1 |
| Right preview \| console tabs | 2 |
| Electron hide/show on tab | 2 |
| Unread console dot | 2 |
| Compact upload / window size / README | 1 |
| &lt;900px stack | 1 |
| No engine changes | all |
