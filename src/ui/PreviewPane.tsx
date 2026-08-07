import { useEffect, useMemo, useRef, useState } from 'react';
import type { FpsStats } from '../preview/devtools';
import {
  DEFAULT_PREVIEW_SIZE_ID,
  PREVIEW_DISPLAY_SCALE,
  PREVIEW_SIZE_PRESETS,
  getPreviewSize,
} from '../preview/devicePresets';
import type { DesktopPreset, DesktopPresetListItem } from '../desktop/api';

interface Props {
  previewUrl: string | null;
  busy?: boolean;
  error?: string | null;
  fpsStats: FpsStats | null;
  desktop?: boolean;
  desktopPreset?: DesktopPreset | null;
  desktopPresets?: DesktopPresetListItem[];
  onRefresh: () => void;
  onRecapture: () => void;
  onPresetChange?: (id: string) => void;
  onMetricsChange?: (metrics: { width: number; height: number; dpr: number }) => void;
  onPreviewBounds?: (bounds: { x: number; y: number; width: number; height: number }) => void;
  /** When true, omit the standalone section heading (parent provides Tab chrome). */
  embedded?: boolean;
  /** When false, skip bounds reporting (e.g. console tab active). */
  active?: boolean;
}

const ELECTRON_PREVIEW_TOKEN = 'electron://preview';

export function PreviewPane({
  previewUrl,
  busy,
  error,
  fpsStats,
  desktop,
  desktopPreset,
  desktopPresets = [],
  onRefresh,
  onRecapture,
  onPresetChange,
  onMetricsChange,
  onPreviewBounds,
  embedded = false,
  active = true,
}: Props) {
  const [sizeId, setSizeId] = useState(DEFAULT_PREVIEW_SIZE_ID);
  const size = useMemo(() => getPreviewSize(sizeId), [sizeId]);
  const frameRef = useRef<HTMLDivElement>(null);
  const isElectronPreview = desktop && previewUrl === ELECTRON_PREVIEW_TOKEN;

  useEffect(() => {
    setSizeId(DEFAULT_PREVIEW_SIZE_ID);
  }, [previewUrl]);

  useEffect(() => {
    onMetricsChange?.({ width: size.w, height: size.h, dpr: 2 });
  }, [size.w, size.h, onMetricsChange]);

  useEffect(() => {
    if (!active || !isElectronPreview || !frameRef.current || !onPreviewBounds) return;
    const el = frameRef.current;
    const report = () => {
      const rect = el.getBoundingClientRect();
      onPreviewBounds({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener('resize', report);
    window.addEventListener('scroll', report, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', report);
      window.removeEventListener('scroll', report, true);
    };
  }, [active, isElectronPreview, onPreviewBounds, size.w, size.h, previewUrl]);

  const fps = fpsStats?.fps ?? null;
  const fpsClass =
    fps == null ? '' : fps >= 50 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-bad';

  const frameW = Math.round(size.w * PREVIEW_DISPLAY_SCALE);
  const frameH = Math.round(size.h * PREVIEW_DISPLAY_SCALE);

  const frameStyle = {
    ['--frame-w' as string]: `${frameW}px`,
    ['--frame-h' as string]: `${frameH}px`,
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
            <select value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
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
            </select>
          </label>

          {desktop && (
            <label className="preview-field">
              <span>设备档位（Electron）</span>
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
          )}
        </div>

        <div className="preview-actions">
          <button type="button" className="btn-ghost" disabled={!previewUrl} onClick={onRefresh}>
            刷新
          </button>
          <button type="button" className="btn-ghost" disabled={!previewUrl} onClick={onRecapture}>
            重新采集探针
          </button>
          {previewUrl && !isElectronPreview && (
            <a className="btn-ghost" href={previewUrl} target="_blank" rel="noreferrer">
              新窗口
            </a>
          )}
        </div>
      </div>

      {desktop && desktopPreset && (
        <p className="perf-hint">
          {desktopPreset.description} 切换档位将<strong>重启应用</strong>
          （V8 堆 / SwiftShader 须在启动前生效）。无法模拟 ARM、发热降频与真机杀进程，发版前请真机兜底。
        </p>
      )}

      <div className="device-stage">
        <div className="device-frame" style={frameStyle} ref={frameRef}>
          {previewUrl && fps != null && (
            <div className={`fps-badge ${fpsClass}`} title="实时帧率">
              <div>{fps} FPS</div>
              {fpsStats?.heapUsedMB != null && (
                <div className="fps-mem">
                  JS {fpsStats.heapUsedMB}
                  {fpsStats.heapLimitMB != null ? `/${fpsStats.heapLimitMB}` : ''} MB
                </div>
              )}
            </div>
          )}
          {error && <div className="preview-error">{error}</div>}
          {!previewUrl && !error && (
            <div className="preview-placeholder">预览窗口将在此显示</div>
          )}
          {previewUrl && !isElectronPreview && (
            <iframe
              title="Playable Preview"
              src={previewUrl}
              sandbox="allow-scripts allow-same-origin"
              className="preview-iframe"
            />
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
  );
}
