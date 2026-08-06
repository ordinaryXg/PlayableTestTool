import { useEffect, useState } from 'react';

type Orientation = 'portrait' | 'landscape';

interface Props {
  previewUrl: string | null;
  busy?: boolean;
  error?: string | null;
  onRefresh: () => void;
  onRecapture: () => void;
}

export function PreviewPane({ previewUrl, busy, error, onRefresh, onRecapture }: Props) {
  const [orientation, setOrientation] = useState<Orientation>('portrait');

  useEffect(() => {
    setOrientation('portrait');
  }, [previewUrl]);

  return (
    <div className="preview-pane">
      <div className="preview-toolbar">
        <div className="seg">
          <button
            type="button"
            className={orientation === 'portrait' ? 'on' : ''}
            onClick={() => setOrientation('portrait')}
          >
            竖屏 320×480
          </button>
          <button
            type="button"
            className={orientation === 'landscape' ? 'on' : ''}
            onClick={() => setOrientation('landscape')}
          >
            横屏 480×320
          </button>
        </div>
        <div className="preview-actions">
          <button type="button" className="btn-ghost" disabled={!previewUrl} onClick={onRefresh}>
            刷新
          </button>
          <button type="button" className="btn-ghost" disabled={!previewUrl} onClick={onRecapture}>
            重新采集探针
          </button>
          {previewUrl && (
            <a className="btn-ghost" href={previewUrl} target="_blank" rel="noreferrer">
              新窗口
            </a>
          )}
        </div>
      </div>

      <div className={`device-frame ${orientation}`}>
        {error && <div className="preview-error">{error}</div>}
        {!previewUrl && !error && (
          <div className="preview-placeholder">预览窗口将在此显示</div>
        )}
        {previewUrl && (
          <iframe
            title="Playable Preview"
            src={previewUrl}
            sandbox="allow-scripts"
            className="preview-iframe"
          />
        )}
        {busy && <div className="preview-busy">探针采集中…</div>}
      </div>
    </div>
  );
}
