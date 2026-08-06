# Playable 合规检测器 — 设计文档

**日期：** 2026-08-06  
**状态：** 待用户审阅  
**范围：** 纯前端单页应用；首版实现 Google App Campaigns / Playable 规则集；架构为可插拔市场规则包 + 必要运行时探针。

---

## 1. 背景与目标

参考 [Google HTML5 Validator](https://h5validator.appspot.com/adwords/asset)，制作可玩素材（Playable）合规检测工具。

**目标用户：** 内部制作同学自检 + 对外/客户侧说明（文案兼顾可操作性与正式度）。

**首版成功标准：**

1. 上传 `.zip` 或 `.html` 后，右侧有独立预览窗口。
2. 按 Google App Campaigns / Playable 要求完成四类检测，并输出可行动的中文 Finding（附英文规则关键词）。
3. 市场与规则以可插拔模块注册，后续可增加其它广告市场而不改核心引擎。

**非目标（首版不做）：**

- 服务端上传、账号、历史记录
- 完整自动化「游玩」脚本
- 非 Google 市场规则的具体实现（仅 UI/注册表占位）

---

## 2. 产品形态与技术选型

| 项 | 选择 |
|----|------|
| 形态 | 纯前端 SPA；文件仅在浏览器内处理 |
| 栈 | Vite + React + TypeScript |
| 解压 | JSZip |
| 预览 | `iframe` 沙箱 + `blob:` / 虚拟文件系统包装页 |
| 文案 | 中文为主；Finding 附英文关键词 |
| 投放场景 | Google App Campaigns / Playable（ZIP ≤ 5.2MB、≤512 文件、插屏尺寸等） |

---

## 3. 架构

```
上传 HTML/ZIP
    ↓
Bundle 解析（JSZip）→ 虚拟文件系统 VFS
    ↓
┌─────────────────┬──────────────────────────┐
│ 静态扫描引擎     │ 独立预览沙箱（iframe）      │
│ RulePack[market]│ + 轻量运行时探针           │
└────────┬────────┴────────────┬─────────────┘
         ↓                     ↓
     合并为统一校验报告（按类别分组）
```

### 3.1 核心抽象

```ts
type Severity = 'error' | 'warning' | 'info';
type RuleCategory =
  | 'policy'      // 政策合规性（创意与退出）
  | 'size'        // 大小与文件完整性
  | 'tooling'     // 创建工具合规性
  | 'structure';  // 必需结构

interface Finding {
  ruleId: string;
  category: RuleCategory;
  severity: Severity;
  messageZh: string;
  keywordEn: string;       // 官方/行业英文关键词，便于对照
  evidence?: {
    path?: string;
    snippet?: string;
    runtime?: boolean;     // 是否来自探针
  };
}

interface RuleContext {
  vfs: Vfs;
  entryHtmlPath: string | null;
  bundle: { fileName: string; byteLength: number; fileCount: number };
  market: MarketModule;
}

interface Rule {
  id: string;
  category: RuleCategory;
  mode: 'static' | 'runtime' | 'hybrid';
  runStatic?: (ctx: RuleContext) => Finding[];
}

interface ProbeEvent {
  type: 'network' | 'exit' | 'storage' | 'navigation';
  detail: Record<string, unknown>;
  at: number;
}

interface Probe {
  id: string;
  /** 注入预览包装页的脚本片段或钩子注册逻辑 */
  install: (bridge: ProbeBridge) => void;
  /** 将探针事件转为 Finding */
  toFindings: (events: ProbeEvent[], ctx: RuleContext) => Finding[];
}

interface MarketModule {
  id: string;              // e.g. 'google-app-playable'
  labelZh: string;
  enabled: boolean;        // 未实现的市场为 false
  limits: {
    maxZipBytes: number;   // 5.2 * 1024 * 1024
    maxFiles: number;      // 512
    allowedExtensions: string[];
    allowedAdSizes: Array<{ w: number; h: number }>;
    externalUrlAllowlist: RegExp[];
  };
  rules: Rule[];
  probes: Probe[];
}
```

新市场 = 新增 `MarketModule` 并注册到 `markets/index.ts`；UI 切换 `activeMarketId` 后重新跑引擎。

### 3.2 模块边界

| 模块 | 职责 | 依赖 |
|------|------|------|
| `vfs` | ZIP/HTML → 路径映射、读文本/字节、列目录 | JSZip |
| `parser` | 主入口发现、HTML/CSS/JS 资源引用提取、meta（ad.size / ad.orientation） | vfs |
| `engine` | 编排静态规则、合并运行时 Finding、去重与 severity 升级 | rules, probes |
| `markets/*` | 各市场 RulePack + limits + probes | engine 类型 |
| `preview` | blob 包装页、沙箱 iframe、探针桥接 `postMessage` | vfs, probes |
| `ui` | 上传、报告、预览控件、市场切换 | engine, preview |

---

## 4. 界面与交互

### 4.1 布局

桌面：左右分栏；窄屏：上下堆叠。

```
┌─ 顶栏：产品名 · 市场选择 ·（预留语言）───────────────────┐
├─ 左：上传 + 结果 ──────────────┬─ 右：独立预览窗 ────────┤
│  拖拽/选择 .zip / .html        │  竖/横切换 · 刷新       │
│  文件摘要                       │  iframe 沙箱            │
│  总览计数（通过/警告/错误）      │  （可选）新窗口打开      │
│  四类折叠 Finding 列表          │                        │
│  复制文本摘要                   │                        │
└────────────────────────────────┴────────────────────────┘
```

### 4.2 流程

1. 上传 → 解析 VFS；失败则阻断预览并出结构类错误。
2. 跑静态 RulePack → 首轮报告。
3. 加载预览并安装探针；约 3–5s 采集窗口后合并运行时 Finding（可手动「重新采集」）。
4. 点击 Finding（有路径时）在结果区展示证据；预览保持独立窗口职责，不强制跳转素材内锚点。
5. 重新上传覆盖当前会话状态。

### 4.3 视觉原则

工具型、清晰层级；状态色：error 红 / warning 黄 / info 中性 / 通过绿。避免花哨仪表盘与无关营销块。

---

## 5. Google App Playable 规则明细

依据 Google Ads 帮助文档（HTML5/Playable for App campaigns 及排错页）。阈值与行为以文档为准写入 `markets/google-app-playable/limits.ts`，便于日后微调。

### 5.1 政策合规性（创意与退出）— `policy`

| ruleId | 方式 | 检测要点 | keywordEn |
|--------|------|----------|-----------|
| `third-party-calls` | hybrid | 静态提取外链；非白名单报错。白名单：Google Fonts、Google-hosted jQuery / Greensock / CreateJS。探针拦截 fetch/XHR/Image/script/link/iframe/WebSocket | Invalid fourth party call / external reference |
| `resource-preload` | static | 不当 prefetch/preload 跨域或指向包外资源 | preload / prefetch |
| `custom-exit-disallowed` | static | 不当自定义退出、GWD 场景下不支持的 ExitAPI 用法等 | Custom exit / Exit found |
| `exit-api-script` | static | `exitapi.js` 须为字面量 script 标签引入；检测 `ExitApi.exit()`；提醒勿仅靠动态注入 | ExitApi.exit / exitapi.js |
| `disallowed-html5` | static | iframe/frame/object/embed、AMP（`amp-*`、cdn.ampproject.org）、localStorage/sessionStorage、不支持 SVG/特征等 | Unsupported HTML5 feature / Unacceptable HTML5 ad |
| `missing-assets` | static | 相对路径引用在 VFS 中不存在 | asset that couldn't be found |
| `multiple-exits` | hybrid | 静态多处 exit；探针统计退出/导航意图次数 | multiple exits |
| `secure-url` | static | `http://`、畸形 URL、非法字符 | Invalid URL / secure URL |

### 5.2 大小与文件完整性 — `size`

| ruleId | 要点 | keywordEn |
|--------|------|-----------|
| `ad-dimensions` | `ad.size` 仅 320×480 或 480×320；或使用 `ad.orientation`（portrait / landscape / 双向）。两者皆有时以 orientation 为准 | Dimensions are not allowed / ad.orientation |
| `bundle-size` | ZIP（或等效包）≤ **5.2 MB**；接近上限给 warning | File size is too large |
| `file-type-and-count` | 文件数 ≤ **512**（文件夹不计）；扩展名限 CSS/GIF/HTML/JPEG/JPG/JS/PNG/SVG；字体嵌入格式按官方允许列表（如 woff/woff2/ttf/otf 等）处理 | unsupported type / too many files |

### 5.3 创建工具合规性 — `tooling`

| ruleId | 要点 | keywordEn |
|--------|------|-----------|
| `doubleclick-studio` | 非 GWD 包出现 Studio `Enabler` 引用 → error。GWD 自带 Enabler 在 Google Ads 环境允许 | DoubleClick Studio / Enabler |
| `gwd-environment` | GWD 资产 `environment` 须为 `gwd-googleads` 或 `gwd-admob`；拒绝 `gwd-genericad` / `gwd-dv360`；检测未 Publish 的源工程特征 | Google Web Designer / gwd-googleads / not published |
| `no-swiffy` | Swiffy 特征字符串/脚本 → error | Swiffy |

### 5.4 必需结构 — `structure`

| ruleId | 要点 | keywordEn |
|--------|------|-----------|
| `path-charset` | 路径/文件名仅字母、数字、`.`、`-`、`_`（无空格等） | unsupported characters in path |
| `filename-length` | ZIP 文件名（不含 `.zip`）≤ 50 字符；包内路径过长给 warning（阈值写入 limits，与官方对齐处优先） | Filename >50 characters |
| `primary-html` | 存在主 HTML；含 doctype、`html`、`head`；`ad.size` 或 `ad.orientation`；显式结束标签要求按文档检查可落地项 | missing a primary .HTML file |
| `primary-creative` | 能解析主入口与必要引用图 | primary creative asset |
| `zip-format` | 可解压、无损坏；单 `.html` 视为单文件包 | ZIP file cannot be processed |

### 5.5 探针约定

- 通过预览包装页注入，经 `postMessage` 回传 `ProbeEvent`。
- 沙箱默认：`allow-scripts`。若资源加载因缺少 `allow-same-origin` 失败，在 UI 提示并记录为 preview 相关 info/warning；不因此丢弃静态结果。
- 默认采集窗口 3–5 秒，可手动重新采集。
- 合并策略：同 `ruleId` 去重；运行时证据可升级 severity 或追加 `evidence.runtime: true`。

首版探针范围（必要项）：

1. 第三方/网络请求  
2. 多次点击退出 / 导航意图  
3. （可选轻量）storage API 调用探测，支撑 `disallowed-html5`

---

## 6. 数据流与错误处理

1. 校验扩展名 → ZIP 解压或单 HTML 入 VFS。  
2. 发现入口 HTML → 构建资源引用图。  
3. 静态规则 → Findings。  
4. 预览 + 探针 → 合并 Findings。  
5. UI 分组展示；生成纯文本摘要供复制。

**错误处理：**

| 情况 | 行为 |
|------|------|
| 损坏/非 ZIP | 阻断预览；`zip-format` error |
| 无主 HTML | 保留文件列表；`primary-html` 等报错 |
| 预览崩溃 / CSP | 静态结果保留；预览区说明原因 |
| 接近体积上限 | warning，仍继续检测 |

---

## 7. 测试策略

- **单元测试：** 各规则对 fixture VFS 的 Finding 快照（合规包、超大、外链、缺资源、Enabler、Swiffy、错误尺寸、非法路径字符、多 exit）。
- **探针测试：** 用带已知外链/多次 `ExitApi.exit` 的夹具 HTML，断言事件与 Finding。
- **手动：** 真实 Playable ZIP 验证预览与报告可读性。

---

## 8. 目录结构（建议）

```
src/
  app/                 # 布局与页面状态
  ui/                  # Upload、Report、PreviewPane、MarketSelect
  vfs/
  parser/
  engine/
  preview/             # wrapper html 生成、probe bridge
  markets/
    index.ts
    google-app-playable/
      index.ts
      limits.ts
      rules/
      probes/
  fixtures/            # 测试用迷你包
```

---

## 9. 决策记录

| 决策 | 结论 |
|------|------|
| 交付形态 | 纯前端 SPA |
| 架构 | 可插拔 MarketModule + 必要运行时探针 |
| 首个市场 | Google App Campaigns / Playable |
| 文案 | 中文为主 + 英文关键词 |
| 技术栈 | Vite + React + TypeScript |
| 预览 | 独立 iframe；与结果区分栏 |

---

## 10. 后续（明确延后）

- 其它市场 RulePack（Meta、TikTok、Unity 等）
- 中英 UI 切换
- Display HTML5（600KB）规则档切换
- 服务端存档与团队协作
