export interface PreviewSizePreset {
  id: string;
  label: string;
  w: number;
  h: number;
  group: 'google' | 'phone' | 'tablet';
}

export const PREVIEW_SIZE_PRESETS: PreviewSizePreset[] = [
  { id: 'google-portrait', label: 'Google 插屏竖屏 320×480', w: 320, h: 480, group: 'google' },
  { id: 'google-landscape', label: 'Google 插屏横屏 480×320', w: 480, h: 320, group: 'google' },
  { id: 'android-360', label: '安卓常见 360×640', w: 360, h: 640, group: 'phone' },
  { id: 'android-412', label: '安卓大屏 412×915', w: 412, h: 915, group: 'phone' },
  { id: 'iphone-se', label: 'iPhone SE 375×667', w: 375, h: 667, group: 'phone' },
  { id: 'iphone-13', label: 'iPhone 13/14 390×844', w: 390, h: 844, group: 'phone' },
  { id: 'iphone-14-pro', label: 'iPhone 14 Pro 393×852', w: 393, h: 852, group: 'phone' },
  { id: 'iphone-14-max', label: 'iPhone 14 Plus 428×926', w: 428, h: 926, group: 'phone' },
  { id: 'tablet-portrait', label: '平板竖屏 768×1024', w: 768, h: 1024, group: 'tablet' },
];

export const DEFAULT_PREVIEW_SIZE_ID = 'google-portrait';

/** Visual scale for on-screen size; iframe renders 1:1 at this pixel size (no CSS scale). */
export const PREVIEW_DISPLAY_SCALE = 1.75;

export function getPreviewSize(id: string): PreviewSizePreset {
  return PREVIEW_SIZE_PRESETS.find((p) => p.id === id) ?? PREVIEW_SIZE_PRESETS[0];
}
