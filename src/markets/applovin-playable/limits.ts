import type { MarketLimits } from '../../types';

/** AppLovin HTML Playable specs (see support.axon.ai creative guidelines). */
export const APPLOVIN_PLAYABLE_LIMITS: MarketLimits = {
  maxZipBytes: 5 * 1024 * 1024,
  warnZipBytes: Math.floor(4 * 1024 * 1024),
  // Single self-contained HTML preferred; ZIP of one HTML still allowed for upload UX
  maxFiles: 1,
  maxZipNameLength: 80,
  maxPathLength: 200,
  allowedExtensions: ['.html', '.htm'],
  // Preview sizes commonly used; AppLovin requires both orientations to work
  allowedAdSizes: [
    { w: 320, h: 480 },
    { w: 480, h: 320 },
    { w: 360, h: 640 },
    { w: 640, h: 360 },
    { w: 390, h: 844 },
    { w: 844, h: 390 },
  ],
  // No external resources / network calls allowed
  externalUrlAllowlist: [],
};

export function isAllowedExternalUrl(url: string, allowlist: RegExp[]): boolean {
  const absolute = url.startsWith('//') ? `https:${url}` : url;
  return allowlist.some((re) => re.test(absolute));
}
