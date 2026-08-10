import type { MarketLimits } from '../../types';

/**
 * Unity Ads User Acquisition — Playable creative specifications
 * @see https://docs.unity.com/zh-cn/grow/acquire/creatives/playable/specifications
 * @see https://docs.unity.com/grow/acquire/creatives/playable/specifications
 */
export const UNITY_PLAYABLE_LIMITS: MarketLimits = {
  maxZipBytes: 5 * 1024 * 1024,
  warnZipBytes: Math.floor(4.5 * 1024 * 1024),
  // Single self-contained HTML (index.html); ZIP of one HTML allowed for upload UX
  maxFiles: 1,
  maxZipNameLength: 80,
  maxPathLength: 200,
  allowedExtensions: ['.html', '.htm'],
  allowedAdSizes: [
    { w: 320, h: 480 },
    { w: 480, h: 320 },
    { w: 360, h: 640 },
    { w: 640, h: 360 },
    { w: 390, h: 844 },
    { w: 844, h: 390 },
    { w: 1080, h: 1920 },
    { w: 1920, h: 1080 },
  ],
  // Asset loads must be inlined; optional analytics XHR may be allowed at runtime
  externalUrlAllowlist: [],
};

export function isAllowedExternalUrl(url: string, allowlist: RegExp[]): boolean {
  const absolute = url.startsWith('//') ? `https:${url}` : url;
  return allowlist.some((re) => re.test(absolute));
}
