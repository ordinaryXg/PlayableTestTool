import { useCallback, useEffect, useRef, useState } from 'react';
import type { Finding, ProbeEvent, RuleContext, ValidationReport, Vfs } from './types';
import { loadBundle } from './vfs';
import { buildRuleExtras, findEntryHtml } from './parser';
import {
  buildReport,
  mergeFindings,
  runProbesToFindings,
  runStatic,
} from './engine';
import { DEFAULT_MARKET_ID, getMarket } from './markets';
import { buildPreviewInjection } from './markets/google-app-playable/probes';
import { buildPreview, type PreviewHandle } from './preview/buildPreview';
import { listenProbeEvents } from './preview/bridge';
import { buildDevtoolsScript, type ConsoleLine, type FpsStats } from './preview/devtools';
import {
  base64ToFile,
  getDesktopApi,
  isElectronDesktop,
  vfsToBase64Map,
  type DesktopPreset,
  type DesktopPresetListItem,
} from './desktop/api';
import { UploadZone } from './ui/UploadZone';
import { ReportPanel } from './ui/ReportPanel';
import { PreviewPane } from './ui/PreviewPane';
import { ConsolePanel } from './ui/ConsolePanel';
import { MarketSelect } from './ui/MarketSelect';
import './styles.css';

const PROBE_WINDOW_MS = 4000;
const MAX_CONSOLE_LINES = 500;
const ELECTRON_PREVIEW_TOKEN = 'electron://preview';

export default function App() {
  const desktop = isElectronDesktop();
  const [marketId, setMarketId] = useState(DEFAULT_MARKET_ID);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [fpsStats, setFpsStats] = useState<FpsStats | null>(null);
  const [desktopPreset, setDesktopPreset] = useState<DesktopPreset | null>(null);
  const [desktopPresets, setDesktopPresets] = useState<DesktopPresetListItem[]>([]);
  const [rightTab, setRightTab] = useState<'preview' | 'console'>('preview');
  const [consoleUnread, setConsoleUnread] = useState(false);
  const rightTabRef = useRef(rightTab);
  useEffect(() => {
    rightTabRef.current = rightTab;
  }, [rightTab]);

  const vfsRef = useRef<Vfs | null>(null);
  const entryRef = useRef<string | null>(null);
  const ctxRef = useRef<RuleContext | null>(null);
  const staticFindingsRef = useRef<Finding[]>([]);
  const previewHandleRef = useRef<PreviewHandle | null>(null);
  const probeEventsRef = useRef<ProbeEvent[]>([]);
  const probeTimerRef = useRef<number | null>(null);
  const consoleIdRef = useRef(0);
  const metricsRef = useRef({ width: 320, height: 480, dpr: 2 });

  const market = getMarket(marketId);

  const pushConsole = useCallback((level: string, message: string, at = Date.now()) => {
    consoleIdRef.current += 1;
    const line: ConsoleLine = {
      id: consoleIdRef.current,
      level,
      message,
      at,
    };
    setConsoleLines((prev) => {
      const next = [...prev, line];
      return next.length > MAX_CONSOLE_LINES ? next.slice(-MAX_CONSOLE_LINES) : next;
    });
    if (rightTabRef.current !== 'console') {
      setConsoleUnread(true);
    }
  }, []);

  const revokePreview = useCallback(() => {
    previewHandleRef.current?.revoke();
    previewHandleRef.current = null;
    setPreviewUrl(null);
    setFpsStats(null);
    const api = getDesktopApi();
    if (api) void api.hidePreview();
  }, []);

  const clearConsole = useCallback(() => {
    setConsoleLines([]);
    setConsoleUnread(false);
  }, []);

  const applyMerged = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const runtime = runProbesToFindings(probeEventsRef.current, ctx);
    const merged = mergeFindings(staticFindingsRef.current, runtime);
    setReport(buildReport(merged, ctx));
  }, []);

  const startProbeCapture = useCallback(() => {
    probeEventsRef.current = [];
    setProbeBusy(true);
    if (probeTimerRef.current) window.clearTimeout(probeTimerRef.current);
    probeTimerRef.current = window.setTimeout(() => {
      setProbeBusy(false);
      applyMerged();
    }, PROBE_WINDOW_MS);
  }, [applyMerged]);

  useEffect(() => {
    if (!desktop) {
      return listenProbeEvents((ev) => {
        if (ev.type === 'console') {
          pushConsole(String(ev.detail.level || 'log'), String(ev.detail.message || ''), ev.at);
          return;
        }
        if (ev.type === 'fps') {
          const value = Number(ev.detail.fps);
          if (!Number.isFinite(value)) return;
          setFpsStats({
            fps: value,
            heapUsedMB:
              typeof ev.detail.heapUsedMB === 'number' ? ev.detail.heapUsedMB : undefined,
            heapLimitMB:
              typeof ev.detail.heapLimitMB === 'number' ? ev.detail.heapLimitMB : undefined,
          });
          return;
        }
        probeEventsRef.current.push(ev);
      });
    }

    const api = getDesktopApi();
    if (!api) return;
    void api.getPreset().then(setDesktopPreset);
    void api.listPresets().then(setDesktopPresets);
    const offConsole = api.onConsole((data) => {
      pushConsole(data.level, data.source ? `${data.message} (${data.source})` : data.message, data.at);
    });
    const offProbe = api.onProbe((data) => {
      if (!data || data.source !== 'playable-validator-probe') return;
      if (data.type === 'console') {
        pushConsole(
          String(data.detail?.level || 'log'),
          String(data.detail?.message || ''),
          data.at || Date.now(),
        );
        return;
      }
      if (data.type === 'fps') {
        const value = Number(data.detail?.fps);
        if (!Number.isFinite(value)) return;
        setFpsStats({
          fps: value,
          heapUsedMB:
            typeof data.detail?.heapUsedMB === 'number' ? data.detail.heapUsedMB : undefined,
          heapLimitMB:
            typeof data.detail?.heapLimitMB === 'number' ? data.detail.heapLimitMB : undefined,
        });
        return;
      }
      probeEventsRef.current.push({
        type: data.type as ProbeEvent['type'],
        detail: data.detail || {},
        at: data.at || Date.now(),
      });
    });
    const offMem = api.onMemoryWarning((data) => {
      pushConsole(
        'warn',
        `[OOM预警] ${data.type} 进程占用 ${data.mb}MB（档位阈值 ${data.limitMb}MB）`,
        data.at,
      );
    });
    const offFps = api.onFps((data) => {
      if (!Number.isFinite(data.fps)) return;
      setFpsStats({
        fps: data.fps,
        heapUsedMB: data.heapUsedMB,
        heapLimitMB: data.heapLimitMB,
      });
    });

    // Session restore after relaunch
    void (async () => {
      const restored = await api.loadRestoredBundle();
      if (!restored) return;
      pushConsole('info', `检测到重启前素材缓存：${restored.fileName}，正在自动恢复…`);
      const file = base64ToFile(restored.fileName, restored.base64);
      setTimeout(() => {
        void runValidationRef.current?.(file);
      }, 50);
    })();

    return () => {
      offConsole();
      offProbe();
      offMem();
      offFps();
    };
  }, [desktop, pushConsole]);

  const mountPreview = useCallback(
    async (vfs: Vfs, entry: string) => {
      revokePreview();
      setPreviewError(null);
      setConsoleLines([]);
      setFpsStats(null);
      try {
        const api = getDesktopApi();
        const probeScript = buildPreviewInjection(market.probes, buildDevtoolsScript());
        if (api) {
          const files = await vfsToBase64Map(vfs);
          const setRes = await api.setPreviewVfs({
            entryHtmlPath: entry,
            files,
            injectScript: probeScript,
          });
          if (!setRes.ok) throw new Error(setRes.error || 'VFS 同步失败');
          const shown = await api.showPreview(metricsRef.current);
          if (!shown.ok) throw new Error(shown.error || '预览打开失败');
          setPreviewUrl(ELECTRON_PREVIEW_TOKEN);
          if (rightTabRef.current !== 'preview') {
            await api.hidePreview();
          }
          startProbeCapture();
          return;
        }

        const handle = await buildPreview(vfs, entry, probeScript);
        previewHandleRef.current = handle;
        setPreviewUrl(handle.url);
        startProbeCapture();
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : String(err));
      }
    },
    [market.probes, revokePreview, startProbeCapture],
  );

  const runValidation = useCallback(
    async (file: File) => {
      setStatus('正在解析…');
      setSelected(null);
      revokePreview();
      setPreviewError(null);
      setConsoleLines([]);

      const api = getDesktopApi();
      if (api) {
        try {
          const buf = new Uint8Array(await file.arrayBuffer());
          let binary = '';
          const chunk = 0x8000;
          for (let i = 0; i < buf.length; i += chunk) {
            binary += String.fromCharCode(...buf.subarray(i, i + chunk));
          }
          await api.saveBundleForRestore({ fileName: file.name, base64: btoa(binary) });
        } catch {
          /* ignore cache failures */
        }
      }

      const loaded = await loadBundle(file);
      vfsRef.current = loaded.vfs;
      const entry = findEntryHtml(loaded.vfs);
      entryRef.current = entry;
      const extras = buildRuleExtras(loaded.vfs, entry);

      const ctx: RuleContext = {
        vfs: loaded.vfs,
        entryHtmlPath: entry,
        bundle: loaded.bundle,
        market,
        refs: extras.refs,
        adMeta: extras.adMeta,
      };
      ctxRef.current = ctx;

      const staticFindings = [...loaded.findings, ...runStatic(ctx)];
      staticFindingsRef.current = staticFindings;
      setReport(buildReport(staticFindings, ctx));
      setStatus(desktop ? '静态检测完成（Electron 预览）' : '静态检测完成');

      const hasZipError = loaded.findings.some((f) => f.ruleId === 'zip-format' && f.severity === 'error');
      if (!hasZipError && entry) {
        await mountPreview(loaded.vfs, entry);
      } else if (!entry) {
        setPreviewError('未找到可预览的主 HTML');
      }
    },
    [desktop, market, mountPreview, revokePreview],
  );

  const runValidationRef = useRef(runValidation);
  useEffect(() => {
    runValidationRef.current = runValidation;
  }, [runValidation]);

  useEffect(() => {
    return () => {
      revokePreview();
      if (probeTimerRef.current) window.clearTimeout(probeTimerRef.current);
    };
  }, [revokePreview]);

  const onRefresh = () => {
    if (vfsRef.current && entryRef.current) {
      void mountPreview(vfsRef.current, entryRef.current);
    }
  };

  const onRecapture = () => {
    startProbeCapture();
    const api = getDesktopApi();
    if (api && previewUrl === ELECTRON_PREVIEW_TOKEN) {
      void api.reloadPreview(metricsRef.current);
      return;
    }
    if (previewUrl && previewHandleRef.current) {
      setPreviewUrl(null);
      requestAnimationFrame(() => setPreviewUrl(previewHandleRef.current?.url ?? null));
    }
  };

  const onPresetChange = async (id: string) => {
    const api = getDesktopApi();
    if (!api) return;
    pushConsole('info', `正在切换设备档位为 ${id}，应用将重启…`);
    await api.setPreset(id);
  };

  const onMetricsChange = (metrics: { width: number; height: number; dpr: number }) => {
    metricsRef.current = metrics;
    const api = getDesktopApi();
    if (api && previewUrl === ELECTRON_PREVIEW_TOKEN) {
      void api.applyPreviewMetrics(metrics);
    }
  };

  const onPreviewBounds = (bounds: { x: number; y: number; width: number; height: number }) => {
    const api = getDesktopApi();
    if (api) void api.updatePreviewBounds(bounds);
  };

  const selectRightTab = (tab: 'preview' | 'console') => {
    setRightTab(tab);
    const api = getDesktopApi();
    if (tab === 'console') {
      setConsoleUnread(false);
      if (api) void api.hidePreview();
      return;
    }
    if (api && previewUrl === ELECTRON_PREVIEW_TOKEN) {
      void (async () => {
        const revealed = await api.revealPreview();
        if (!revealed.ok) {
          await api.showPreview(metricsRef.current);
        }
      })();
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">PV</span>
          <div>
            <h1>Playable 合规检测器</h1>
            <p>
              {desktop
                ? `Electron 桌面版 · 档位 ${desktopPreset?.label ?? '…'}`
                : '本地检测 · 文件不离开浏览器'}
            </p>
          </div>
        </div>
        <MarketSelect value={marketId} onChange={setMarketId} />
      </header>

      <main className="workspace">
        <section className="pane pane-left">
          <div className="pane-block pane-upload">
            <div className="section-head">
              <h2>上传素材</h2>
            </div>
            <UploadZone compact onFile={(f) => void runValidation(f)} />
            {status && <div className="status">{status}</div>}
          </div>

          <div className="pane-block pane-report">
            <div className="section-head">
              <h2>素材检测</h2>
            </div>
            <div className="report-scroll">
              <ReportPanel
                report={report}
                marketLabel={market.labelZh}
                selected={selected}
                onSelect={setSelected}
              />
            </div>
          </div>
        </section>

        <section className="pane pane-right">
          <div className="right-tabs" role="tablist" aria-label="预览与控制台">
            <button
              type="button"
              role="tab"
              aria-selected={rightTab === 'preview'}
              className={`right-tab${rightTab === 'preview' ? ' active' : ''}`}
              onClick={() => selectRightTab('preview')}
            >
              预览
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={rightTab === 'console'}
              className={`right-tab${rightTab === 'console' ? ' active' : ''}`}
              onClick={() => selectRightTab('console')}
            >
              控制台
              {consoleUnread && <span className="tab-dot" aria-label="有新日志" />}
            </button>
          </div>

          <div
            className={`tab-panel tab-preview${rightTab === 'preview' ? ' active' : ''}`}
            role="tabpanel"
            hidden={rightTab !== 'preview'}
          >
            <PreviewPane
              previewUrl={previewUrl}
              busy={probeBusy}
              error={previewError}
              fpsStats={fpsStats}
              desktop={desktop}
              desktopPreset={desktopPreset}
              desktopPresets={desktopPresets}
              embedded
              active={rightTab === 'preview'}
              onRefresh={onRefresh}
              onRecapture={onRecapture}
              onPresetChange={(id) => void onPresetChange(id)}
              onMetricsChange={onMetricsChange}
              onPreviewBounds={onPreviewBounds}
            />
          </div>

          <div
            className={`tab-panel tab-console${rightTab === 'console' ? ' active' : ''}`}
            role="tabpanel"
            hidden={rightTab !== 'console'}
          >
            <ConsolePanel lines={consoleLines} onClear={clearConsole} />
          </div>
        </section>
      </main>
    </div>
  );
}
