import type { MarketLimits } from '../../types';

/**
 * Meta / Facebook Playable Ads asset specs
 * @see https://developers.facebook.com/documentation/games/acquire/click-to-play-ads/creative
 * @see https://www.facebook.com/business/help/412951382532338
 * @see https://developers.facebook.com/docs/app-ads/formats/playable-ad/
 */
export const FACEBOOK_PLAYABLE_LIMITS: MarketLimits = {
  // ZIP archive ≤ 5MB (single HTML uses a separate 2MB rule)
  maxZipBytes: 5 * 1024 * 1024,
  warnZipBytes: Math.floor(4.5 * 1024 * 1024),
  maxFiles: 100,
  maxZipNameLength: 80,
  maxPathLength: 200,
  allowedExtensions: [
    '.html',
    '.htm',
    '.js',
    '.css',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.svg',
    '.mp3',
    '.wav',
    '.ogg',
    '.m4a',
    '.json',
    '.txt',
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
  ],
  allowedAdSizes: [
    { w: 320, h: 480 },
    { w: 360, h: 640 },
    { w: 390, h: 844 },
    { w: 414, h: 896 },
    { w: 1080, h: 1920 },
  ],
  // No external network / asset loading
  externalUrlAllowlist: [],
};

/** Single HTML / ZIP 内 index.html 上限 2MB（API 报错 Uploaded File Is Too Large） */
export const FACEBOOK_HTML_MAX_BYTES = 2 * 1024 * 1024;
export const FACEBOOK_HTML_WARN_BYTES = Math.floor(1.8 * 1024 * 1024);

export function isAllowedExternalUrl(url: string, allowlist: RegExp[]): boolean {
  const absolute = url.startsWith('//') ? `https:${url}` : url;
  return allowlist.some((re) => re.test(absolute));
}
