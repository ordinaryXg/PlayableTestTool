import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Finding, ProbeEvent, RuleContext, ValidationReport, Vfs } from './types';
import { loadBundle } from './vfs';
import { buildRuleExtras, findEntryHtml } from './parser';
import {
  buildReport,
  mergeFindings,
  runProbesToFindings,
  runStatic,
} from './engine';
import { DEFAULT_MARKET_ID, getMarket, marketDisplayName, isMarketRulesReady } from './markets';
import { buildPreviewInjection } from './markets/google-app-playable/probes';
import { buildDevtoolsScript, type ConsoleLine, type FpsStats } from './preview/devtools';
import {
  base64ToFile,
  getDesktopApi,
  vfsToBase64Map,
  type DesktopPreset,
  type DesktopPresetListItem,
} from './desktop/api';
import { UploadZone } from './ui/UploadZone';
import { ReportPanel } from './ui/ReportPanel';
import { PreviewPane } from './ui/PreviewPane';
import { ConsolePanel } from './ui/ConsolePanel';
import { MarketSelect } from './ui/MarketSelect';
import { LanguageSelect } from './ui/LanguageSelect';
import {
  DEFAULT_PREVIEW_LANGUAGE,
  previewLanguageToLocale,
  type PreviewLanguageId,
} from './preview/languages';
import './styles.css';

const PROBE_WINDOW_MS = 4000;
const MAX_CONSOLE_LINES = 500;
const ELECTRON_PREVIEW_TOKEN = 'electron://preview';

export default function App() {
  const api = getDesktopApi();
  const [marketId, setMarketId] = useState(DEFAULT_MARKET_ID);
  const [previewLanguage, setPreviewLanguage] = useState<PreviewLanguageId>(
    DEFAULT_PREVIEW_LANGUAGE,
  );
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
  const [leftPct, setLeftPct] = useState(() => {
    try {
      const raw = localStorage.getItem('pv-left-pct');
      const n = raw ? Number(raw) : 42;
      return Number.isFinite(n) ? Math.min(70, Math.max(22, n)) : 42;
    } catch {
      return 42;
    }
  });
  const rightTabRef = useRef(rightTab);
  const splitDragRef = useRef<{ startX: number; startPct: number } | null>(null);
  const leftPctRef = useRef(leftPct);
  useEffect(() => {
    rightTabRef.current = rightTab;
  }, [rightTab]);
  useEffect(() => {
    leftPctRef.current = leftPct;
  }, [leftPct]);

  const vfsRef = useRef<Vfs | null>(null);
  const entryRef = useRef<string | null>(null);
  const ctxRef = useRef<RuleContext | null>(null);
  const staticFindingsRef = useRef<Finding[]>([]);
  const probeEventsRef = useRef<ProbeEvent[]>([]);
  const probeTimerRef = useRef<number | null>(null);
  const consoleIdRef = useRef(0);
  const metricsRef = useRef({ width: 320, height: 480, dpr: 2, pageScale: 1 });

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
    setPreviewUrl(null);
    setFpsStats(null);
    if (api) void api.hidePreview();
  }, [api]);

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
        // Electron desktop: FPS comes from main-process poll (pv:fps), not inject probe.
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
  }, [api, pushConsole]);

  const mountPreview = useCallback(
    async (vfs: Vfs, entry: string) => {
      if (!api) {
        setPreviewError('请在 Electron 桌面应用中运行');
        return;
      }
      // Avoid hidePreview() before remount — zeroes WebContentsView and can blank WebGL.
      setFpsStats(null);
      setPreviewError(null);
      setConsoleLines([]);
      try {
        const probeScript = buildPreviewInjection(market.probes, buildDevtoolsScript(), {
          channel: market.channel,
          language: previewLanguage,
          locale: previewLanguageToLocale(previewLanguage),
        });
        const files = await vfsToBase64Map(vfs);
        const setRes = await api.setPreviewVfs({
          entryHtmlPath: entry,
          files,
          injectScript: probeScript,
          previewEnv: {
            channel: market.channel,
            language: previewLanguage,
            locale: previewLanguageToLocale(previewLanguage),
          },
        });
        if (!setRes.ok) throw new Error(setRes.error || 'VFS 同步失败');
        const shown = await api.showPreview(metricsRef.current);
        if (!shown.ok) throw new Error(shown.error || '预览打开失败');
        setPreviewUrl(ELECTRON_PREVIEW_TOKEN);
        if (rightTabRef.current !== 'preview') {
          await api.hidePreview();
        }
        startProbeCapture();
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, market.probes, market.channel, previewLanguage, startProbeCapture],
  );

  const runValidation = useCallback(
    async (file: File) => {
      setStatus('正在解析…');
      setSelected(null);
      revokePreview();
      setPreviewError(null);
      setConsoleLines([]);

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
      setStatus('静态检测完成');

      const hasZipError = loaded.findings.some((f) => f.ruleId === 'zip-format' && f.severity === 'error');
      if (!hasZipError && entry) {
        await mountPreview(loaded.vfs, entry);
      } else if (!entry) {
        setPreviewError('未找到可预览的主 HTML');
      }
    },
    [api, market, mountPreview, revokePreview],
  );

  const runValidationRef = useRef(runValidation);
  useEffect(() => {
    runValidationRef.current = runValidation;
  }, [runValidation]);

  // Re-run static rules when market changes (keep current VFS / preview).
  useEffect(() => {
    const vfs = vfsRef.current;
    const entry = entryRef.current;
    if (!vfs || !ctxRef.current) return;
    const extras = buildRuleExtras(vfs, entry);
    const ctx: RuleContext = {
      vfs,
      entryHtmlPath: entry,
      bundle: ctxRef.current.bundle,
      market,
      refs: extras.refs,
      adMeta: extras.adMeta,
    };
    ctxRef.current = ctx;
    const priorLoad = staticFindingsRef.current.filter((f) => f.ruleId === 'zip-format');
    const staticFindings = [...priorLoad, ...runStatic(ctx)];
    staticFindingsRef.current = staticFindings;
    setReport(buildReport(staticFindings, ctx));
    setStatus(
      isMarketRulesReady(market)
        ? `已切换市场：${marketDisplayName(market)}（curChannel="${market.channel}"）`
        : `已切换市场：${marketDisplayName(market)}（未接入规则，仅注入 curChannel="${market.channel}"）`,
    );
    if (entry) void mountPreview(vfs, entry);
    // intentionally only when market module changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId]);

  // Re-inject window.curLanguage and reload preview when language changes.
  const languageBootRef = useRef(true);
  useEffect(() => {
    if (languageBootRef.current) {
      languageBootRef.current = false;
      return;
    }
    const vfs = vfsRef.current;
    const entry = entryRef.current;
    if (!vfs || !entry || !ctxRef.current) return;
    setStatus(
      `已切换预览语言：navigator.language = "${previewLanguageToLocale(previewLanguage)}"（curLanguage=${previewLanguage}）`,
    );
    void mountPreview(vfs, entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewLanguage]);

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
    if (api && previewUrl === ELECTRON_PREVIEW_TOKEN) {
      void api.reloadPreview(metricsRef.current);
    }
  };

  const onOpenLargePreview = () => {
    const api = getDesktopApi();
    if (!api || previewUrl !== ELECTRON_PREVIEW_TOKEN) return;
    setFpsStats(null);
    void api.openPreviewPopup({
      width: metricsRef.current.width,
      height: metricsRef.current.height,
      dpr: metricsRef.current.dpr,
    });
  };

  const onPresetChange = async (id: string) => {
    if (!api) return;
    pushConsole('info', `正在热切换设备档位为 ${id}（CPU/网络立即生效）…`);
    const res = await api.setPreset(id);
    const next = await api.getPreset();
    setDesktopPreset(next);
    if (res.processLimitsPending) {
      pushConsole(
        'warn',
        '当前进程的 V8 堆上限 / SwiftShader 仍为启动时配置；完整对齐需点击「重启以应用堆/软渲染」。',
      );
    } else {
      pushConsole('info', `设备档位已切换为 ${next.label}`);
    }
    if (previewUrl === ELECTRON_PREVIEW_TOKEN) {
      void api.applyPreviewMetrics(metricsRef.current);
    }
  };

  const onRelaunchForPreset = async () => {
    const api = getDesktopApi();
    if (!api || !desktopPreset) return;
    pushConsole('info', '正在重启以应用 V8 堆 / SwiftShader…');
    await api.relaunchForPreset(desktopPreset.id);
  };

  const onMetricsChange = useCallback(
    (metrics: { width: number; height: number; dpr: number; pageScale?: number }) => {
      metricsRef.current = {
        width: metrics.width,
        height: metrics.height,
        dpr: metrics.dpr,
        pageScale: metrics.pageScale ?? 1,
      };
      const api = getDesktopApi();
      if (api && previewUrl === ELECTRON_PREVIEW_TOKEN) {
        void api.applyPreviewMetrics(metricsRef.current);
      }
    },
    [previewUrl],
  );

  const onPreviewBounds = useCallback(
    (bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
      pageScale?: number;
    }) => {
      const api = getDesktopApi();
      if (api) void api.updatePreviewBounds(bounds);
    },
    [],
  );

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

  const onSplitPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    splitDragRef.current = { startX: e.clientX, startPct: leftPctRef.current };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add('is-splitting');
  };

  const onSplitPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = splitDragRef.current;
    if (!drag) return;
    const root = e.currentTarget.parentElement;
    const width = root?.getBoundingClientRect().width || window.innerWidth;
    if (width < 1) return;
    const deltaPct = ((e.clientX - drag.startX) / width) * 100;
    const next = Math.min(70, Math.max(22, drag.startPct + deltaPct));
    setLeftPct(next);
  };

  const endSplitDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!splitDragRef.current) return;
    splitDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    document.body.classList.remove('is-splitting');
    try {
      localStorage.setItem('pv-left-pct', String(Math.round(leftPctRef.current * 10) / 10));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="app">
      <main
        className="workspace"
        style={{ gridTemplateColumns: `minmax(240px, ${leftPct}%) 6px minmax(320px, 1fr)` }}
      >
        <section className="pane pane-left">
          <div className="pane-block pane-upload">
            <div className="section-head">
              <h2>上传素材</h2>
            </div>
            <div className="preview-env-selects">
              <MarketSelect value={marketId} onChange={setMarketId} />
              <LanguageSelect value={previewLanguage} onChange={setPreviewLanguage} />
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
                marketLabel={marketDisplayName(market)}
                selected={selected}
                onSelect={setSelected}
              />
            </div>
          </div>
        </section>

        <div
          className="workspace-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(leftPct)}
          aria-valuemin={22}
          aria-valuemax={70}
          aria-label="调整左右栏宽度"
          tabIndex={0}
          onPointerDown={onSplitPointerDown}
          onPointerMove={onSplitPointerMove}
          onPointerUp={endSplitDrag}
          onPointerCancel={endSplitDrag}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              setLeftPct((p) => Math.max(22, p - 2));
            } else if (e.key === 'ArrowRight') {
              setLeftPct((p) => Math.min(70, p + 2));
            }
          }}
        />

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
              desktopPreset={desktopPreset}
              desktopPresets={desktopPresets}
              embedded
              active={rightTab === 'preview'}
              onRefresh={onRefresh}
              onRecapture={onRecapture}
              onOpenLargePreview={onOpenLargePreview}
              onPresetChange={(id) => void onPresetChange(id)}
              onRelaunchForPreset={() => void onRelaunchForPreset()}
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
