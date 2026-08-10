export interface PreviewSizePreset {
  id: string;
  label: string;
  w: number;
  h: number;
  group: 'google' | 'phone' | 'tablet' | 'desktop' | 'custom';
}

export const PREVIEW_SIZE_PRESETS: PreviewSizePreset[] = [
  { id: 'google-portrait', label: 'Google 插屏竖屏 320×480', w: 320, h: 480, group: 'google' },
  { id: 'google-landscape', label: 'Google 插屏横屏 480×320', w: 480, h: 320, group: 'google' },
  { id: 'android-360', label: '安卓常见 360×640', w: 360, h: 640, group: 'phone' },
  { id: 'android-412', label: '安卓大屏 412×915', w: 412, h: 915, group: 'phone' },
  { id: 'android-1080', label: '安卓 FHD 1080×1920', w: 1080, h: 1920, group: 'phone' },
  { id: 'android-1440', label: '安卓 QHD 1440×2560', w: 1440, h: 2560, group: 'phone' },
  { id: 'iphone-se', label: 'iPhone SE 375×667', w: 375, h: 667, group: 'phone' },
  { id: 'iphone-13', label: 'iPhone 13/14 390×844', w: 390, h: 844, group: 'phone' },
  { id: 'iphone-14-pro', label: 'iPhone 14 Pro 393×852', w: 393, h: 852, group: 'phone' },
  { id: 'iphone-14-max', label: 'iPhone 14 Plus 428×926', w: 428, h: 926, group: 'phone' },
  { id: 'iphone-15-pro-max', label: 'iPhone 15 Pro Max 430×932', w: 430, h: 932, group: 'phone' },
  { id: 'tablet-portrait', label: '平板竖屏 768×1024', w: 768, h: 1024, group: 'tablet' },
  { id: 'ipad-pro-11', label: 'iPad Pro 11 834×1194', w: 834, h: 1194, group: 'tablet' },
  { id: 'ipad-pro-12', label: 'iPad Pro 12.9 1024×1366', w: 1024, h: 1366, group: 'tablet' },
  { id: 'hd-landscape', label: '横屏 HD 1280×720', w: 1280, h: 720, group: 'desktop' },
  { id: 'fhd-landscape', label: '横屏 FHD 1920×1080', w: 1920, h: 1080, group: 'desktop' },
  { id: 'qhd-landscape', label: '横屏 QHD 2560×1440', w: 2560, h: 1440, group: 'desktop' },
  { id: 'fhd-portrait', label: '竖屏 FHD 1080×1920', w: 1080, h: 1920, group: 'desktop' },
];

export const DEFAULT_PREVIEW_SIZE_ID = 'google-portrait';

const CUSTOM_STORAGE_KEY = 'pv-custom-preview-sizes';

export type CustomPreviewSize = {
  id: string;
  label: string;
  w: number;
  h: number;
};

function clampDim(n: number): number {
  if (!Number.isFinite(n)) return 320;
  return Math.min(4096, Math.max(120, Math.round(n)));
}

export function loadCustomPreviewSizes(): CustomPreviewSize[] {
  try {
    const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const w = clampDim(Number((item as CustomPreviewSize).w));
        const h = clampDim(Number((item as CustomPreviewSize).h));
        const id = String((item as CustomPreviewSize).id || `custom-${w}x${h}`);
        const label = String((item as CustomPreviewSize).label || `自定义 ${w}×${h}`);
        return { id, label, w, h };
      })
      .filter((x) => x.w >= 120 && x.h >= 120);
  } catch {
    return [];
  }
}

function persistCustomSizes(list: CustomPreviewSize[]) {
  localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(list));
}

export function saveCustomPreviewSize(w: number, h: number, label?: string): CustomPreviewSize {
  const cw = clampDim(w);
  const ch = clampDim(h);
  const id = `custom-${cw}x${ch}-${Date.now().toString(36)}`;
  const entry: CustomPreviewSize = {
    id,
    label: (label && label.trim()) || `自定义 ${cw}×${ch}`,
    w: cw,
    h: ch,
  };
  const next = [...loadCustomPreviewSizes().filter((x) => !(x.w === cw && x.h === ch)), entry];
  persistCustomSizes(next);
  return entry;
}

export function deleteCustomPreviewSize(id: string): CustomPreviewSize[] {
  const next = loadCustomPreviewSizes().filter((x) => x.id !== id);
  persistCustomSizes(next);
  return next;
}

export function getPreviewSize(
  id: string,
  customs: CustomPreviewSize[] = loadCustomPreviewSizes(),
): PreviewSizePreset {
  const builtin = PREVIEW_SIZE_PRESETS.find((p) => p.id === id);
  if (builtin) return builtin;
  const custom = customs.find((p) => p.id === id);
  if (custom) {
    return { ...custom, group: 'custom' };
  }
  return PREVIEW_SIZE_PRESETS[0]!;
}
