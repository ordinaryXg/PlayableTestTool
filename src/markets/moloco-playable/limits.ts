import type { MarketLimits } from '../../types';

/**
 * Moloco Ads — Playable & Interactive End Card (IEC) creative guide
 * @see https://help.moloco.com/hc/zh-cn/articles/24124525963799
 * @see https://help.moloco.com/hc/en-us/articles/24124525963799-Playable-and-Interactive-End-Card-IEC-creative-guide
 */
export const MOLOCO_PLAYABLE_LIMITS: MarketLimits = {
  maxZipBytes: 5 * 1024 * 1024,
  warnZipBytes: Math.floor(4.5 * 1024 * 1024),
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
  externalUrlAllowlist: [],
};

export function isAllowedExternalUrl(url: string, allowlist: RegExp[]): boolean {
  const absolute = url.startsWith('//') ? `https:${url}` : url;
  return allowlist.some((re) => re.test(absolute));
}
