import type { MarketLimits } from '../../types';

export const GOOGLE_APP_PLAYABLE_LIMITS: MarketLimits = {
  maxZipBytes: Math.floor(5.2 * 1024 * 1024),
  warnZipBytes: Math.floor(4.5 * 1024 * 1024),
  maxFiles: 512,
  maxZipNameLength: 50,
  maxPathLength: 200,
  allowedExtensions: [
    '.css',
    '.gif',
    '.html',
    '.htm',
    '.jpeg',
    '.jpg',
    '.js',
    '.png',
    '.svg',
    // allowed font embeds
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    '.eot',
    '.dfont',
    '.tte',
  ],
  allowedAdSizes: [
    { w: 320, h: 480 },
    { w: 480, h: 320 },
  ],
  externalUrlAllowlist: [
    /^https?:\/\/fonts\.googleapis\.com\//i,
    /^https?:\/\/fonts\.gstatic\.com\//i,
    /^https?:\/\/ajax\.googleapis\.com\/ajax\/libs\/jquery\//i,
    /^https?:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/gsap\//i,
    /^https?:\/\/cdn\.jsdelivr\.net\/npm\/gsap/i,
    /^https?:\/\/s0\.2mdn\.net\/ads\/studio\/Enabler\.js/i, // noted for GWD; custom Studio still flagged by tooling rule
    // Google-hosted Greensock / CreateJS common hosts
    /^https?:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/gsap\//i,
    /^https?:\/\/code\.createjs\.com\//i,
    /^https?:\/\/[^/]*googleapis\.com\/.*(?:tween|ease|timeline|cssplugin|createjs|easel|tweenjs)/i,
    /^https?:\/\/tpc\.googlesyndication\.com\/pagead\/gadgets\/html5\/api\/exitapi/i,
    /^https?:\/\/www\.gstatic\.com\/.*exitapi/i,
  ],
};

export function isAllowedExternalUrl(url: string, allowlist: RegExp[]): boolean {
  const absolute = url.startsWith('//') ? `https:${url}` : url;
  return allowlist.some((re) => re.test(absolute));
}
