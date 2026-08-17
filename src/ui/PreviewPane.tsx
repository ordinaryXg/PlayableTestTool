import { useEffect, useMemo, useRef, useState } from 'react';
import type { FpsStats } from '../preview/devtools';
import {
  DEFAULT_PREVIEW_SIZE_ID,
  PREVIEW_SIZE_PRESETS,
  deleteCustomPreviewSize,
  getPreviewSize,
  loadCustomPreviewSizes,
  saveCustomPreviewSize,
  type CustomPreviewSize,
} from '../preview/devicePresets';
import type { DesktopPreset, DesktopPresetListItem } from '../desktop/api';

interface Props {
  previewUrl: string | null;
  busy?: boolean;
  error?: string | null;
  fpsStats: FpsStats | null;
  desktopPreset?: DesktopPreset | null;
  desktopPresets?: DesktopPresetListItem[];
  onRefresh: () => void;
  onRecapture: () => void;
  onOpenLargePreview?: () => void;
  onPresetChange?: (id: string) => void;
  onRelaunchForPreset?: () => void;
  onMetricsChange?: (metrics: {
    width: number;
    height: number;
    dpr: number;
    pageScale?: number;
  }) => void;
  onPreviewBounds?: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    pageScale?: number;
  }) => void;
  embedded?: boolean;
  active?: boolean;
}

const ELECTRON_PREVIEW_TOKEN = 'electron://preview';
const ZOOM_MIN = 25;
const ZOOM_MAX = 100;
const ZOOM_DEFAULT = 100;
const STAGE_PAD = 8;

export function PreviewPane({
  previewUrl,
  busy,
  error,
  fpsStats,
  desktopPreset,
  desktopPresets = [],
  onRefresh,
  onRecapture,
  onOpenLargePreview,
  onPresetChange,
  onRelaunchForPreset,
  onMetricsChange,
  onPreviewBounds,
  embedded = false,
  active = true,
}: Props) {
  const [sizeId, setSizeId] = useState(DEFAULT_PREVIEW_SIZE_ID);
  const [customSizes, setCustomSizes] = useState<CustomPreviewSize[]>(() => loadCustomPreviewSizes());
  const [customW, setCustomW] = useState(1080);
  const [customH, setCustomH] = useState(1920);
  const [zoomPercent, setZoomPercent] = useState(ZOOM_DEFAULT);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  const baseSize = useMemo(() => getPreviewSize(sizeId, customSizes), [sizeId, customSizes]);
  const size = useMemo(() => {
    const portrait = baseSize.h >= baseSize.w;
    if (orientation === 'portrait') {
      return portrait ? baseSize : { ...baseSize, w: baseSize.h, h: baseSize.w };
    }
    return !portrait ? baseSize : { ...baseSize, w: baseSize.h, h: baseSize.w };
  }, [baseSize, orientation]);

  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const isElectronPreview = previewUrl === ELECTRON_PREVIEW_TOKEN;

  // 100% = fit inside stage; lower values shrink. Never exceeds stage (no overlay).
  const fitScale = useMemo(() => {
    const userZoom = zoomPercent / 100;
    if (stageSize.w < 32 || stageSize.h < 32 || size.w < 1 || size.h < 1) {
      return Math.max(0.05, userZoom);
    }
    const availW = Math.max(32, stageSize.w - STAGE_PAD);
    const availH = Math.max(32, stageSize.h - STAGE_PAD);
    const contain = Math.min(availW / size.w, availH / size.h);
    return Math.max(0.05, contain * userZoom);
  }, [stageSize.w, stageSize.h, size.w, size.h, zoomPercent]);

  const effectivePercent = Math.round(fitScale * 100);
  const scaledW = Math.max(1, Math.round(size.w * fitScale));
  const scaledH = Math.max(1, Math.round(size.h * fitScale));

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setStageSize({
        w: Math.max(0, Math.floor(r.width)),
        h: Math.max(0, Math.floor(r.height)),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [active, embedded]);

  useEffect(() => {
    // Logical layout size stays fixed; pageScale is the fitted on-screen scale.
    onMetricsChange?.({ width: size.w, height: size.h, dpr: 2, pageScale: fitScale });
  }, [size.w, size.h, fitScale, onMetricsChange]);

  useEffect(() => {
    if (!active || !onPreviewBounds) return;
    const report = () => {
      const el = shellRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = rect.width > 1 ? rect.width : scaledW;
      const height = rect.height > 1 ? rect.height : scaledH;
      onPreviewBounds({
        x: rect.x,
        y: rect.y,
        width,
        height,
        pageScale: fitScale,
      });
    };
    report();
    const raf = requestAnimationFrame(() => {
      report();
      requestAnimationFrame(report);
    });
    const el = shellRef.current;
    const ro = el ? new ResizeObserver(report) : null;
    if (el && ro) ro.observe(el);
    window.addEventListener('resize', report);
    window.addEventListener('scroll', report, true);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', report);
      window.removeEventListener('scroll', report, true);
    };
  }, [active, onPreviewBounds, scaledW, scaledH, fitScale, previewUrl]);

  const fps = fpsStats?.fps ?? null;
  const fpsClass =
    fps == null ? '' : fps >= 50 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-bad';

  const shellStyle = { width: scaledW, height: scaledH };
  const frameStyle = {
    ['--frame-w' as string]: `${scaledW}px`,
    ['--frame-h' as string]: `${scaledH}px`,
    width: scaledW,
    height: scaledH,
    transform: 'none',
  };

  const applySizeId = (id: string) => {
    setSizeId(id);
    const preset = getPreviewSize(id, customSizes);
    setOrientation(preset.h >= preset.w ? 'portrait' : 'landscape');
  };

  const onSaveCustom = () => {
    const saved = saveCustomPreviewSize(customW, customH);
    const next = loadCustomPreviewSizes();
    setCustomSizes(next);
    applySizeId(saved.id);
  };

  const onDeleteCustom = () => {
    if (!sizeId.startsWith('custom-')) return;
    const next = deleteCustomPreviewSize(sizeId);
    setCustomSizes(next);
    applySizeId(DEFAULT_PREVIEW_SIZE_ID);
  };

  return (
    <div className={`preview-pane${embedded ? ' embedded' : ''}`}>
      {!embedded && (
        <div className="section-head">
          <h2>预览窗口</h2>
        </div>
      )}

      <div className="preview-toolbar">
        <div className="preview-selects">
          <label className="preview-field">
            <span>分辨率</span>
            <select value={sizeId} onChange={(e) => applySizeId(e.target.value)}>
              <optgroup label="Google 插屏">
                {PREVIEW_SIZE_PRESETS.filter((p) => p.group === 'google').map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="手机">
                {PREVIEW_SIZE_PRESETS.filter((p) => p.group === 'phone').map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="平板">
                {PREVIEW_SIZE_PRESETS.filter((p) => p.group === 'tablet').map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="大屏 / 桌面">
                {PREVIEW_SIZE_PRESETS.filter((p) => p.group === 'desktop').map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
              {customSizes.length > 0 && (
                <optgroup label="自定义">
                  {customSizes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          <div className="preview-field preview-custom-size" title="自定义分辨率">
            <span>自定义</span>
            <div className="preview-custom-row">
              <input
                className="preview-custom-input"
                type="number"
                min={120}
                max={4096}
                value={customW}
                aria-label="自定义宽度"
                onChange={(e) => setCustomW(Number(e.target.value) || 120)}
              />
              <span className="preview-custom-x" aria-hidden>
                ×
              </span>
              <input
                className="preview-custom-input"
                type="number"
                min={120}
                max={4096}
                value={customH}
                aria-label="自定义高度"
                onChange={(e) => setCustomH(Number(e.target.value) || 120)}
              />
              <button type="button" className="btn-ghost btn-compact" onClick={onSaveCustom}>
                保存
              </button>
              {sizeId.startsWith('custom-') && (
                <button type="button" className="btn-ghost btn-compact" onClick={onDeleteCustom}>
                  删除
                </button>
              )}
            </div>
          </div>

          <label className="preview-field">
            <span>设备档位</span>
            <select
              value={desktopPreset?.id ?? 'mid'}
              onChange={(e) => onPresetChange?.(e.target.value)}
            >
              {desktopPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.heap > 0 ? ` · 堆${p.heap}MB` : ''}
                  {p.softGpu ? ' · 软渲染' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="preview-orient-zoom">
            <button
              type="button"
              className="btn-orient"
              title="切换横竖屏并刷新预览"
              onClick={() => {
                const next = orientation === 'portrait' ? 'landscape' : 'portrait';
                const preset = getPreviewSize(sizeId, customSizes);
                const basePortrait = preset.h >= preset.w;
                let w = preset.w;
                let h = preset.h;
                if (next === 'portrait' && !basePortrait) {
                  w = preset.h;
                  h = preset.w;
                } else if (next === 'landscape' && basePortrait) {
                  w = preset.h;
                  h = preset.w;
                }
                setOrientation(next);
                onMetricsChange?.({
                  width: w,
                  height: h,
                  dpr: 2,
                  pageScale: fitScale,
                });
                requestAnimationFrame(() => onRefresh());
              }}
            >
              {orientation === 'portrait' ? '切换横屏' : '切换竖屏'}
            </button>
            <label className="preview-zoom">
              <span>
                视窗缩放 {zoomPercent}%
                {stageSize.w >= 32
                  ? ` · 显示 ${effectivePercent}%（${scaledW}×${scaledH}）`
                  : ''}
              </span>
              <div className="preview-zoom-row">
                <input
                  type="range"
                  min={ZOOM_MIN}
                  max={ZOOM_MAX}
                  step={5}
                  value={zoomPercent}
                  onChange={(e) => setZoomPercent(Number(e.target.value))}
                  onInput={(e) =>
                    setZoomPercent(Number((e.target as HTMLInputElement).value))
                  }
                  aria-valuemin={ZOOM_MIN}
                  aria-valuemax={ZOOM_MAX}
                  aria-valuenow={zoomPercent}
                  aria-label="视窗缩放"
                />
                <span className="preview-zoom-value">{zoomPercent}%</span>
              </div>
            </label>
          </div>
        </div>

        <div className="preview-actions">
          <button
            type="button"
            className="btn-ghost btn-large-preview"
            disabled={!previewUrl}
            title="在新窗口中以更大尺寸预览"
            onClick={() => onOpenLargePreview?.()}
          >
            大屏
          </button>
          <button type="button" className="btn-ghost" disabled={!previewUrl} onClick={onRefresh}>
            刷新
          </button>
          <button type="button" className="btn-ghost" disabled={!previewUrl} onClick={onRecapture}>
            重新采集探针
          </button>
        </div>
      </div>

      {desktopPreset && (
        <div className="perf-hint-block">
          <p className="perf-hint">
            {desktopPreset.description} CPU 节流与弱网可<strong>即时切换</strong>
            ；V8 堆上限 / SwiftShader 软渲染须进程启动前生效
            {desktopPreset.processLimitsPending
              ? '（当前与启动配置不一致）'
              : ''}
            。预览会自动缩放到可视区域内，逻辑分辨率保持 {size.w}×{size.h}。
          </p>
          {desktopPreset.processLimitsPending && (
            <button type="button" className="btn-ghost btn-relaunch" onClick={onRelaunchForPreset}>
              重启以应用堆/软渲染
            </button>
          )}
        </div>
      )}

      {previewUrl && (
        <div className="fps-row">
          <div
            className={`fps-chip ${fps == null ? 'fps-wait' : fpsClass}`}
            title="预览实时帧率 / JS 堆"
          >
            <span className="fps-chip-main">{fps == null ? '— FPS' : `${fps} FPS`}</span>
            <span className="fps-chip-mem">
              {fpsStats?.heapUsedMB != null
                ? `JS ${fpsStats.heapUsedMB}${
                    fpsStats.heapLimitMB != null ? `/${fpsStats.heapLimitMB}` : ''
                  } MB`
                : 'JS — MB'}
            </span>
          </div>
        </div>
      )}

      <div className="device-stage" ref={stageRef}>
        <div className="device-preview-wrap">
          <div className="device-zoom-shell" style={shellStyle} ref={shellRef}>
            <div className="device-frame" style={frameStyle}>
              {error && <div className="preview-error">{error}</div>}
              {!previewUrl && !error && (
                <div className="preview-placeholder">预览窗口将在此显示</div>
              )}
              {isElectronPreview && (
                <div className="preview-iframe electron-host" aria-hidden>
                  {/* WebContentsView is composited by Electron main over this rect */}
                </div>
              )}
              {busy && <div className="preview-busy">探针采集中…</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
