import type { MarketLimits } from '../../types';

/**
 * Mintegral / Mindworks Playable Testing guidelines
 * @see https://www.playturbo.cn/review/doc
 * @see https://www.playturbo.com/review/doc
 * @see https://helpcenter.mintegral.com/en/docs/asset-specs
 */
export const MINTEGRAL_PLAYABLE_LIMITS: MarketLimits = {
  maxZipBytes: 5 * 1024 * 1024,
  warnZipBytes: Math.floor(4.5 * 1024 * 1024),
  maxFiles: 200,
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
    { w: 480, h: 320 },
    { w: 360, h: 640 },
    { w: 640, h: 360 },
    { w: 390, h: 844 },
    { w: 844, h: 390 },
    { w: 1080, h: 1920 },
    { w: 1920, h: 1080 },
  ],
  // Prefer self-contained; external refs still flagged
  externalUrlAllowlist: [],
};

export function isAllowedExternalUrl(url: string, allowlist: RegExp[]): boolean {
  const absolute = url.startsWith('//') ? `https:${url}` : url;
  return allowlist.some((re) => re.test(absolute));
}

/** Zip base name without extension; only letters/numbers/underscore per Mindworks. */
export function zipBaseName(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() || fileName;
  return base.replace(/\.(zip|html?)$/i, '');
}

export function isSafeFileToken(name: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(name);
}
