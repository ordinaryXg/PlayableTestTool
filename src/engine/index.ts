import type { Finding, MarketModule, ProbeEvent, RuleContext, Severity, ValidationReport } from '../types';

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warning: 1,
  error: 2,
};

export function runStatic(ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  for (const rule of ctx.market.rules) {
    if (!rule.runStatic) continue;
    try {
      out.push(...rule.runStatic(ctx));
    } catch (err) {
      out.push({
        ruleId: rule.id,
        category: rule.category,
        severity: 'warning',
        messageZh: `规则执行异常：${err instanceof Error ? err.message : String(err)}`,
        keywordEn: 'rule execution error',
      });
    }
  }
  return out;
}

export function runProbesToFindings(events: ProbeEvent[], ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  for (const probe of ctx.market.probes) {
    out.push(...probe.toFindings(events, ctx));
  }
  return out;
}

export function mergeFindings(staticFindings: Finding[], runtimeFindings: Finding[]): Finding[] {
  const map = new Map<string, Finding>();

  const keyOf = (f: Finding) =>
    `${f.ruleId}::${f.evidence?.path ?? ''}::${f.evidence?.snippet ?? f.messageZh}`;

  for (const f of staticFindings) {
    map.set(keyOf(f), f);
  }

  for (const f of runtimeFindings) {
    const runtimeF: Finding = {
      ...f,
      evidence: { ...f.evidence, runtime: true },
    };
    // Prefer matching by ruleId for upgrade
    const sameRule = [...map.values()].filter((x) => x.ruleId === f.ruleId);
    if (sameRule.length === 0) {
      map.set(keyOf(runtimeF), runtimeF);
      continue;
    }
    // Upgrade severity on existing or add new evidence entry
    let upgraded = false;
    for (const [k, existing] of map) {
      if (existing.ruleId !== f.ruleId) continue;
      if (SEVERITY_RANK[runtimeF.severity] > SEVERITY_RANK[existing.severity]) {
        map.set(k, {
          ...existing,
          severity: runtimeF.severity,
          evidence: {
            ...existing.evidence,
            ...runtimeF.evidence,
            runtime: true,
            snippet: [existing.evidence?.snippet, runtimeF.evidence?.snippet]
              .filter(Boolean)
              .join(' | '),
          },
        });
        upgraded = true;
      }
    }
    if (!upgraded) {
      map.set(keyOf(runtimeF), runtimeF);
    }
  }

  return [...map.values()].sort((a, b) => {
    const s = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (s !== 0) return s;
    return a.ruleId.localeCompare(b.ruleId);
  });
}

export function countFindings(findings: Finding[]) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

export function buildReport(findings: Finding[], ctx: Pick<RuleContext, 'bundle' | 'entryHtmlPath'>): ValidationReport {
  return {
    findings,
    bundle: ctx.bundle,
    entryHtmlPath: ctx.entryHtmlPath,
    counts: countFindings(findings),
  };
}

export function createContext(
  partial: Omit<RuleContext, 'market'> & { market: MarketModule },
): RuleContext {
  return partial;
}

export function formatReportText(report: ValidationReport, marketLabel: string): string {
  const lines = [
    `Playable 合规检测报告 — ${marketLabel}`,
    `文件：${report.bundle.fileName}（${(report.bundle.byteLength / 1024).toFixed(1)} KB，${report.bundle.fileCount} 个文件）`,
    `入口：${report.entryHtmlPath ?? '（未找到）'}`,
    `结果：错误 ${report.counts.error} / 警告 ${report.counts.warning} / 提示 ${report.counts.info}`,
    '',
  ];
  if (report.findings.length === 0) {
    lines.push('全部检查通过。');
  } else {
    for (const f of report.findings) {
      lines.push(
        `[${f.severity.toUpperCase()}] (${f.category}) ${f.ruleId}: ${f.messageZh} [${f.keywordEn}]` +
          (f.evidence?.path ? ` @ ${f.evidence.path}` : '') +
          (f.evidence?.snippet ? ` — ${f.evidence.snippet}` : '') +
          (f.evidence?.runtime ? ' (runtime)' : ''),
      );
    }
  }
  return lines.join('\n');
}
