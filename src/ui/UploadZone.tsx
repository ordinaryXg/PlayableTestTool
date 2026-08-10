import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from 'react';

interface Props {
  disabled?: boolean;
  compact?: boolean;
  onFile: (file: File) => void;
}

export function UploadZone({ disabled, compact, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const take = useCallback(
    (file: File | undefined | null) => {
      if (!file || disabled) return;
      onFile(file);
    },
    [disabled, onFile],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    take(e.dataTransfer.files?.[0]);
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    take(e.target.files?.[0]);
    e.target.value = '';
  };

  return (
    <div
      className={`upload-zone ${compact ? 'compact' : ''} ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
    >
      <div className="upload-icon" aria-hidden>
        ↑
      </div>
      <p className="upload-title">{compact ? '拖拽或选择 Playable 文件' : '拖拽 Playable 文件到此处'}</p>
      <p className="upload-sub">支持 .zip / .html{compact ? '' : ' — 或'}</p>
      <button type="button" className={`btn-primary${compact ? ' btn-compact' : ''}`} disabled={disabled}>
        选择文件
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,.html,.htm,application/zip,text/html"
        hidden
        onChange={onChange}
      />
    </div>
  );
}
