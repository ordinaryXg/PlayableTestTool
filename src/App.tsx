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
import { buildProbeScript } from './markets/google-app-playable/probes';
import { buildPreview, type PreviewHandle } from './preview/buildPreview';
import { listenProbeEvents } from './preview/bridge';
import { UploadZone } from './ui/UploadZone';
import { ReportPanel } from './ui/ReportPanel';
import { PreviewPane } from './ui/PreviewPane';
import { MarketSelect } from './ui/MarketSelect';
import './styles.css';

const PROBE_WINDOW_MS = 4000;

export default function App() {
  const [marketId, setMarketId] = useState(DEFAULT_MARKET_ID);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [status, setStatus] = useState<string>('');

  const vfsRef = useRef<Vfs | null>(null);
  const entryRef = useRef<string | null>(null);
  const ctxRef = useRef<RuleContext | null>(null);
  const staticFindingsRef = useRef<Finding[]>([]);
  const previewHandleRef = useRef<PreviewHandle | null>(null);
  const probeEventsRef = useRef<ProbeEvent[]>([]);
  const probeTimerRef = useRef<number | null>(null);

  const market = getMarket(marketId);

  const revokePreview = () => {
    previewHandleRef.current?.revoke();
    previewHandleRef.current = null;
    setPreviewUrl(null);
  };

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
    return listenProbeEvents((ev) => {
      probeEventsRef.current.push(ev);
    });
  }, []);

  useEffect(() => {
    return () => {
      revokePreview();
      if (probeTimerRef.current) window.clearTimeout(probeTimerRef.current);
    };
  }, []);

  const mountPreview = useCallback(
    async (vfs: Vfs, entry: string) => {
      revokePreview();
      setPreviewError(null);
      try {
        const probeScript = buildProbeScript(market.probes);
        const handle = await buildPreview(vfs, entry, probeScript);
        previewHandleRef.current = handle;
        setPreviewUrl(handle.url);
        startProbeCapture();
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : String(err));
      }
    },
    [market.probes, startProbeCapture],
  );

  const runValidation = useCallback(
    async (file: File) => {
      setStatus('正在解析…');
      setSelected(null);
      revokePreview();
      setPreviewError(null);

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
    [market, mountPreview],
  );

  const onRefresh = () => {
    if (vfsRef.current && entryRef.current) {
      void mountPreview(vfsRef.current, entryRef.current);
    }
  };

  const onRecapture = () => {
    startProbeCapture();
    // force iframe reload to re-fire early network
    if (previewUrl) {
      setPreviewUrl(null);
      requestAnimationFrame(() => setPreviewUrl(previewHandleRef.current?.url ?? null));
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">PV</span>
          <div>
            <h1>Playable 合规检测器</h1>
            <p>本地检测 · 文件不离开浏览器</p>
          </div>
        </div>
        <MarketSelect value={marketId} onChange={setMarketId} />
      </header>

      <main className="layout">
        <section className="left">
          <UploadZone onFile={(f) => void runValidation(f)} />
          {status && <div className="status">{status}</div>}
          <ReportPanel
            report={report}
            marketLabel={market.labelZh}
            selected={selected}
            onSelect={setSelected}
          />
        </section>
        <section className="right">
          <PreviewPane
            previewUrl={previewUrl}
            busy={probeBusy}
            error={previewError}
            onRefresh={onRefresh}
            onRecapture={onRecapture}
          />
        </section>
      </main>
    </div>
  );
}
