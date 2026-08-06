import { useMemo, useState } from 'react';
import type { Finding, RuleCategory, ValidationReport } from '../types';
import { formatReportText } from '../engine';

const CATEGORY_LABEL: Record<RuleCategory, string> = {
  policy: '政策合规性（创意与退出）',
  size: '大小与文件完整性',
  tooling: '创建工具合规性',
  structure: '必需结构',
};

const ORDER: RuleCategory[] = ['policy', 'size', 'tooling', 'structure'];

interface Props {
  report: ValidationReport | null;
  marketLabel: string;
  selected: Finding | null;
  onSelect: (f: Finding | null) => void;
}

export function ReportPanel({ report, marketLabel, selected, onSelect }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    policy: true,
    size: true,
    tooling: true,
    structure: true,
  });

  const grouped = useMemo(() => {
    const map: Record<RuleCategory, Finding[]> = {
      policy: [],
      size: [],
      tooling: [],
      structure: [],
    };
    if (!report) return map;
    for (const f of report.findings) map[f.category].push(f);
    return map;
  }, [report]);

  if (!report) {
    return (
      <div className="report empty">
        <p>上传素材后将在此显示检测结果。</p>
      </div>
    );
  }

  const passed = report.counts.error === 0 && report.counts.warning === 0;

  return (
    <div className="report">
      <div className="report-summary">
        <div className={`pill ${passed ? 'ok' : report.counts.error ? 'err' : 'warn'}`}>
          {passed ? '通过' : report.counts.error ? '未通过' : '有警告'}
        </div>
        <div className="counts">
          <span className="err">错误 {report.counts.error}</span>
          <span className="warn">警告 {report.counts.warning}</span>
          <span className="info">提示 {report.counts.info}</span>
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            void navigator.clipboard.writeText(formatReportText(report, marketLabel));
          }}
        >
          复制摘要
        </button>
      </div>

      <div className="bundle-meta">
        <div>
          <strong>{report.bundle.fileName}</strong>
        </div>
        <div>
          {(report.bundle.byteLength / 1024).toFixed(1)} KB · {report.bundle.fileCount} 个文件 · 入口{' '}
          {report.entryHtmlPath ?? '—'}
        </div>
      </div>

      {ORDER.map((cat) => {
        const items = grouped[cat];
        return (
          <section key={cat} className="finding-group">
            <button
              type="button"
              className="group-head"
              onClick={() => setOpen((o) => ({ ...o, [cat]: !o[cat] }))}
            >
              <span>
                {CATEGORY_LABEL[cat]}
                <em>{items.length}</em>
              </span>
              <span>{open[cat] ? '▾' : '▸'}</span>
            </button>
            {open[cat] && (
              <ul className="finding-list">
                {items.length === 0 ? (
                  <li className="finding ok-line">本类检查通过</li>
                ) : (
                  items.map((f, i) => (
                    <li key={`${f.ruleId}-${i}`}>
                      <button
                        type="button"
                        className={`finding ${f.severity} ${selected === f ? 'active' : ''}`}
                        onClick={() => onSelect(selected === f ? null : f)}
                      >
                        <div className="finding-top">
                          <span className="sev">{f.severity}</span>
                          <code>{f.ruleId}</code>
                          {f.evidence?.runtime ? <span className="rt">运行时</span> : null}
                        </div>
                        <p>{f.messageZh}</p>
                        <div className="kw">{f.keywordEn}</div>
                        {selected === f && f.evidence && (
                          <div className="evidence">
                            {f.evidence.path && <div>路径：{f.evidence.path}</div>}
                            {f.evidence.snippet && <div>证据：{f.evidence.snippet}</div>}
                          </div>
                        )}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
