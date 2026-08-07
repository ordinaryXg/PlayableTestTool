import { useEffect, useRef } from 'react';
import type { ConsoleLine } from '../preview/devtools';

interface Props {
  lines: ConsoleLine[];
  onClear: () => void;
}

export function ConsolePanel({ lines, onClear }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="console-panel">
      <div className="console-head">
        <span className="console-count">{lines.length} 条</span>
        <button type="button" className="btn-ghost" onClick={onClear}>
          清空
        </button>
      </div>
      <div className="console-body" ref={scrollerRef}>
        {lines.length === 0 ? (
          <div className="console-empty">预览运行后，这里会同步素材的 console / 错误输出</div>
        ) : (
          lines.map((line) => (
            <div key={line.id} className={`console-line level-${line.level}`}>
              <span className="console-time">
                {new Date(line.at).toLocaleTimeString('zh-CN', { hour12: false })}
              </span>
              <span className="console-level">{line.level}</span>
              <span className="console-msg">{line.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
