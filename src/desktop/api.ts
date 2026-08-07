export type DesktopPreset = {
  id: string;
  label: string;
  description: string;
  heap: number;
  softGpu: boolean;
  cpu: number;
  metrics?: { width: number; height: number; dpr: number };
  requiresRelaunch?: boolean;
};

export type DesktopPresetListItem = {
  id: string;
  label: string;
  description: string;
  heap: number;
  softGpu: boolean;
  cpu: number;
};

export type PreviewBounds = { x: number; y: number; width: number; height: number };

export type PvDesktopApi = {
  isDesktop: true;
  getPreset: () => Promise<DesktopPreset>;
  listPresets: () => Promise<DesktopPresetListItem[]>;
  setPreset: (presetId: string) => Promise<{ ok: boolean; relaunching?: boolean }>;
  setPreviewVfs: (payload: {
    entryHtmlPath: string;
    files: Record<string, string>; // path -> base64
    injectScript?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  showPreview: (metrics?: { width: number; height: number; dpr: number }) => Promise<{
    ok: boolean;
    error?: string;
  }>;
  hidePreview: () => Promise<{ ok: boolean }>;
  reloadPreview: (metrics?: { width: number; height: number; dpr: number }) => Promise<{
    ok: boolean;
  }>;
  updatePreviewBounds: (bounds: PreviewBounds) => Promise<{ ok: boolean }>;
  applyPreviewMetrics: (metrics: {
    width: number;
    height: number;
    dpr: number;
  }) => Promise<{ ok: boolean }>;
  saveBundleForRestore: (payload: {
    fileName: string;
    base64: string;
  }) => Promise<{ ok: boolean }>;
  loadRestoredBundle: () => Promise<{ fileName: string; base64: string } | null>;
  clearRestoredBundle: () => Promise<{ ok: boolean }>;
  onConsole: (
    cb: (data: { level: string; message: string; source?: string; at: number }) => void,
  ) => () => void;
  onProbe: (
    cb: (data: {
      source?: string;
      type: string;
      detail?: Record<string, unknown>;
      at?: number;
    }) => void,
  ) => () => void;
  onMemoryWarning: (
    cb: (data: { type: string; pid: number; mb: number; limitMb: number; at: number }) => void,
  ) => () => void;
  onFps: (
    cb: (data: { fps: number; heapUsedMB?: number; heapLimitMB?: number }) => void,
  ) => () => void;
};

export function getDesktopApi(): PvDesktopApi | null {
  const w = window as Window & { pvDesktop?: PvDesktopApi };
  return w.pvDesktop?.isDesktop ? w.pvDesktop : null;
}

export function isElectronDesktop(): boolean {
  return getDesktopApi() != null;
}

export async function vfsToBase64Map(
  vfs: { paths: () => string[]; readBytes: (p: string) => Uint8Array | null },
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const p of vfs.paths()) {
    const bytes = vfs.readBytes(p);
    if (!bytes) continue;
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    files[p] = btoa(binary);
  }
  return files;
}

export function base64ToFile(fileName: string, base64: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, {
    type: fileName.toLowerCase().endsWith('.html') ? 'text/html' : 'application/zip',
  });
}
