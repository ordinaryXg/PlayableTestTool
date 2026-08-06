export type Severity = 'error' | 'warning' | 'info';

export type RuleCategory = 'policy' | 'size' | 'tooling' | 'structure';

export interface Finding {
  ruleId: string;
  category: RuleCategory;
  severity: Severity;
  messageZh: string;
  keywordEn: string;
  evidence?: {
    path?: string;
    snippet?: string;
    runtime?: boolean;
  };
}

export interface BundleMeta {
  fileName: string;
  byteLength: number;
  fileCount: number;
  sourceKind: 'zip' | 'html';
}

export interface VfsFile {
  path: string;
  bytes: Uint8Array;
}

export interface Vfs {
  readonly files: Map<string, Uint8Array>;
  paths(): string[];
  has(path: string): boolean;
  readText(path: string): string | null;
  readBytes(path: string): Uint8Array | null;
  normalize(path: string): string;
}

export interface ResourceRef {
  fromPath: string;
  raw: string;
  resolved: string | null;
  kind: 'script' | 'link' | 'img' | 'css-url' | 'js-url' | 'iframe' | 'other';
  isExternal: boolean;
}

export interface AdMeta {
  size?: { w: number; h: number };
  orientation?: string;
  environment?: string;
  isGwd: boolean;
}

export interface RuleContext {
  vfs: Vfs;
  entryHtmlPath: string | null;
  bundle: BundleMeta;
  market: MarketModule;
  refs: ResourceRef[];
  adMeta: AdMeta;
  parseError?: string;
}

export interface Rule {
  id: string;
  category: RuleCategory;
  mode: 'static' | 'runtime' | 'hybrid';
  runStatic?: (ctx: RuleContext) => Finding[];
}

export type ProbeEventType = 'network' | 'exit' | 'storage' | 'navigation';

export interface ProbeEvent {
  type: ProbeEventType;
  detail: Record<string, unknown>;
  at: number;
}

export interface ProbeBridge {
  post(event: ProbeEvent): void;
}

export interface Probe {
  id: string;
  /** Returns JS source injected into the preview wrapper (IIFE-friendly). */
  script: string;
  toFindings: (events: ProbeEvent[], ctx: RuleContext) => Finding[];
}

export interface MarketLimits {
  maxZipBytes: number;
  warnZipBytes: number;
  maxFiles: number;
  maxZipNameLength: number;
  maxPathLength: number;
  allowedExtensions: string[];
  allowedAdSizes: Array<{ w: number; h: number }>;
  externalUrlAllowlist: RegExp[];
}

export interface MarketModule {
  id: string;
  labelZh: string;
  enabled: boolean;
  limits: MarketLimits;
  rules: Rule[];
  probes: Probe[];
}

export interface ValidationReport {
  findings: Finding[];
  bundle: BundleMeta;
  entryHtmlPath: string | null;
  counts: { error: number; warning: number; info: number };
}
