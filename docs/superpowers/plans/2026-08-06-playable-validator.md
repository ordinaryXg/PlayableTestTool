# Playable Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付纯前端 Playable 合规检测 SPA：上传 ZIP/HTML、独立预览、Google App Playable 四类规则 + 必要运行时探针，市场规则可插拔。

**Architecture:** JSZip → VFS → 静态 RulePack + iframe 探针 → 合并 Finding；`MarketModule` 注册表支持后续市场。

**Tech Stack:** Vite 6 + React 19 + TypeScript + JSZip + Vitest

## Global Constraints

- 纯前端，文件不出浏览器
- UI 中文为主；Finding 附 `keywordEn`
- 首版市场：`google-app-playable`（ZIP ≤ 5.2MB，≤512 文件）
- Spec：`docs/superpowers/specs/2026-08-06-playable-validator-design.md`

---

## File Structure

```
package.json
vite.config.ts
tsconfig.json
index.html
src/main.tsx
src/App.tsx
src/styles.css
src/types.ts
src/vfs/index.ts
src/parser/index.ts
src/engine/index.ts
src/preview/bridge.ts
src/preview/buildPreview.ts
src/markets/index.ts
src/markets/google-app-playable/index.ts
src/markets/google-app-playable/limits.ts
src/markets/google-app-playable/rules/*.ts
src/markets/google-app-playable/probes/*.ts
src/ui/UploadZone.tsx
src/ui/ReportPanel.tsx
src/ui/PreviewPane.tsx
src/ui/MarketSelect.tsx
src/fixtures/...
src/**/*.test.ts
```

---

### Task 1: Scaffold Vite React TS + Vitest

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/vite-env.d.ts`

- [ ] **Step 1:** `npm create vite@latest . -- --template react-ts`（若目录非空则手写等价配置）并安装 `jszip`、`vitest`、`@types/jszip`
- [ ] **Step 2:** 配置 `vitest`（jsdom 或 node 环境，规则测可用 node）
- [ ] **Step 3:** `npm run build` 通过；提交 scaffold

---

### Task 2: Core types + VFS

**Files:**
- Create: `src/types.ts`, `src/vfs/index.ts`, `src/vfs/vfs.test.ts`

**Produces:**
- `loadBundle(file: File): Promise<{ vfs: Vfs; bundle: BundleMeta; error?: Finding }>`
- `Vfs`: `paths()`, `has(path)`, `readText(path)`, `readBytes(path)`, `normalize(path)`

- [ ] **Step 1:** 写测试：单 HTML、合法 ZIP、损坏 ZIP
- [ ] **Step 2:** 实现 VFS + loadBundle
- [ ] **Step 3:** 测试通过并提交

---

### Task 3: Parser（入口 + 资源图 + meta）

**Files:**
- Create: `src/parser/index.ts`, `src/parser/parser.test.ts`

**Produces:**
- `findEntryHtml(vfs): string | null`
- `parseAdMeta(html): { size?: {w,h}; orientation?: string }`
- `collectReferences(vfs, entryPath): Ref[]`（html/css/js 相对与绝对 URL）

- [ ] 测试 + 实现 + 提交

---

### Task 4: Engine + Market registry skeleton

**Files:**
- Create: `src/engine/index.ts`, `src/markets/index.ts`, `src/markets/google-app-playable/limits.ts`, `src/markets/google-app-playable/index.ts`

**Produces:**
- `runStatic(ctx): Finding[]`
- `mergeFindings(static, runtime): Finding[]`
- `getMarket(id)`, `listMarkets()`

- [ ] 测试 merge 去重/升级 + 实现 + 提交

---

### Task 5: Google structure + size rules

**Files:**
- Create: `src/markets/google-app-playable/rules/structure.ts`, `size.ts`, 对应 `*.test.ts`

**Rules:** `zip-format`, `path-charset`, `filename-length`, `primary-html`, `primary-creative`, `ad-dimensions`, `bundle-size`, `file-type-and-count`

- [ ] 每条规则 fixture 测试 + 实现 + 提交

---

### Task 6: Google policy + tooling rules

**Files:**
- Create: `src/markets/google-app-playable/rules/policy.ts`, `tooling.ts`, 对应测试

**Rules:** `third-party-calls`, `resource-preload`, `custom-exit-disallowed`, `exit-api-script`, `disallowed-html5`, `missing-assets`, `multiple-exits`, `secure-url`, `doubleclick-studio`, `gwd-environment`, `no-swiffy`

- [ ] fixture 测试 + 实现 + 提交

---

### Task 7: Preview + runtime probes

**Files:**
- Create: `src/preview/buildPreview.ts`, `src/preview/bridge.ts`, `src/markets/google-app-playable/probes/network.ts`, `exit.ts`, `storage.ts`

**Produces:**
- `buildPreviewUrl(vfs, entryPath, probeScript): Promise<{ url: string; revoke: () => void }>`
- Probe 脚本拦截 network / ExitApi.exit / storage，`postMessage` 到父页
- `collectProbeFindings(events, ctx): Finding[]`

- [ ] 单元测 toFindings；手动可在 UI 验证 + 提交

---

### Task 8: UI 壳 + 串联

**Files:**
- Create/Modify: `src/App.tsx`, `src/ui/*`, `src/styles.css`

- [ ] Upload → 静态报告 → Preview → 探针合并 → 复制摘要
- [ ] 市场选择（Google 启用；其它 disabled 占位）
- [ ] `npm run build` + `npm test` 全绿 + 提交

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| 上传 + 独立预览 | 2, 7, 8 |
| 政策 8 项 | 6, 7 |
| 大小 3 项 | 5 |
| 工具 3 项 | 6 |
| 结构 5 项 | 5 |
| MarketModule 可插拔 | 4 |
| 中文 + keywordEn | 5–8 |
| 探针网络/多次退出 | 7 |

## Execution

用户已要求「推进到落地」→ 本会话 **Inline Execution**（executing-plans），按 Task 1→8 连续实现并验证。
