# Playable 合规检测器

本地 **Electron 桌面应用**，检测 Playable（HTML5）素材是否符合投放市场规则。文件不会上传到服务器。

已启用市场规则：

- **Google** / **AppLovin** / **Facebook** / **Unity**（完整合规规则）
- **Moloco** / **Liftoff** / **Mintegral**（仅预览 `curChannel`，规则未接入）

本工具**仅提供桌面应用**，不提供浏览器网页版。

---

## 环境要求

- Node.js 18+（建议 LTS）
- Windows（当前打包目标为 Windows）

```bash
npm install
```

---

## 怎么用

### 1. 启动应用

开发调试：

```bash
npm run dev
```

会同时拉起 Vite（仅作渲染进程热更新）和 Electron 窗口。  
若提示端口占用，先关掉占用 5173 的进程再启动。

已构建产物：

```bash
npm run build
npm start
```

### 2. 上传素材

在「上传素材」区域拖入或选择：

- `.zip`（整包）
- 或单文件 `.html`

应用会在本地解压/解析，并自动跑静态规则检测。

### 3. 看结果（左右分栏）

| 区域 | 作用 |
|------|------|
| **左侧** | 上传素材 + 市场/语言 + 检测报告 |
| **右侧 · 预览** | 分辨率 / 设备档位、机型框、FPS |
| **右侧 · 控制台** | console 镜像、OOM 预警 |

预览区常用操作：

- **市场规则**：切换合规规则，并注入 `window.curChannel`
- **预览语言**：覆盖 `navigator.language` / `window.curLanguage`
- **分辨率**：Google 插屏 / 手机 / 平板预设
- **设备档位**：高端 / 中端 / 低端
- **刷新** / **重新采集探针**

### 4. 设备档位

| 档位 | 含义（简要） |
|------|----------------|
| 高端旗舰 | 不节流 · 硬件 GPU · 快网 |
| 中端主流（默认） | CPU 4× · JS 堆 512MB · 4G |
| 低端入门 | CPU 6× · JS 堆 256MB · SwiftShader · 弱 4G |

CPU / 弱网可热切换；V8 堆上限与 SwiftShader 需重启进程（界面有「重启以应用」）。重启后会尽量自动恢复上次素材。

> 边界：无法模拟 ARM、发热降频、真机杀进程、真实 GPU 驱动差异。本工具是日常冒烟层，**发版前请用真机兜底**。

---

## 打包安装包

```bash
npm run electron:build
```

成功后产物在 `release/`：

- NSIS 安装包
- Portable 便携版

若本机对项目目录有文件锁（杀软等）导致 `EPERM`，可稍后再打，或把 `package.json` → `build.directories.output` 改到其它可写目录。

---

## 其它命令

```bash
npm test                 # 规则单测
npm run build            # 构建渲染层到 dist/
npm run electron:start   # 用 dist 启动 Electron（等同 npm start）
```

---

## 文档

- 设计：`docs/superpowers/specs/2026-08-06-playable-validator-design.md`
- 计划：`docs/superpowers/plans/2026-08-06-playable-validator.md`
