# Playable 合规检测器

本地检测 Playable（HTML5）素材是否符合 **Google App Campaigns / Playable** 规则。文件不会上传到服务器。

推荐使用 **Electron 桌面版**：可按设备档位压测（CPU 节流、弱网、V8 堆上限、软渲染）。纯浏览器模式只适合改 UI / 规则，没有真实性能杠杆。

---

## 环境要求

- Node.js 18+（建议 LTS）
- Windows（当前打包目标为 Windows）

```bash
npm install
```

---

## 怎么用（日常检测）

### 1. 启动桌面版

```bash
npm run electron:dev
```

会同时拉起 Vite（`http://127.0.0.1:5173`）和 Electron 窗口。  
若提示端口占用，先关掉占用 5173 的进程再启动。

已打包产物也可用：

```bash
npm run build
npm run electron:start
```

### 2. 上传素材

在「上传素材」区域拖入或选择：

- `.zip`（整包）
- 或单文件 `.html`

应用会在本地解压/解析，并自动跑静态规则检测。

### 3. 看结果（左右分栏）

桌面默认布局：

| 区域 | 作用 |
|------|------|
| **左侧** | 上传素材 + 检测报告（Finding 列表） |
| **右侧 · 预览** | 分辨率 / 设备档位、机型框、FPS |
| **右侧 · 控制台** | console 镜像、OOM 预警（Tab 切换） |

窄窗口会自动改为上下堆叠。

预览区常用操作：

- **分辨率**：Google 插屏 / 手机 / 平板预设
- **设备档位**（仅 Electron）：高端 / 中端 / 低端
- **刷新**：重新加载预览
- **重新采集探针**：再跑一小段运行时采集窗口

### 4. 设备档位（Electron）

| 档位 | 含义（简要） |
|------|----------------|
| 高端旗舰 | 不节流 · 硬件 GPU · 快网 |
| 中端主流（默认） | CPU 4× · JS 堆 512MB · 4G |
| 低端入门 | CPU 6× · JS 堆 256MB · SwiftShader · 弱 4G |

**切换档位会重启应用**（V8 堆 / 软渲染必须在启动前生效）。重启后会尽量自动恢复上次上传的素材。

> 边界：无法模拟 ARM、发热降频、真机杀进程、真实 Mali/Adreno 驱动差异。本工具是日常冒烟层，**发版前请用真机兜底**。

---

## 纯浏览器模式（无档位）

只做界面或规则开发时：

```bash
npm run dev
```

浏览器打开终端里的本地地址，上传流程相同，但预览走 blob iframe，**没有**堆上限 / SwiftShader / CDP 节流。

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
npm test          # 规则单测
npm run build     # 仅构建渲染层到 dist/
npm run preview   # 预览 dist（浏览器）
```

---

## 文档

- 设计：`docs/superpowers/specs/2026-08-06-playable-validator-design.md`
- 计划：`docs/superpowers/plans/2026-08-06-playable-validator.md`
