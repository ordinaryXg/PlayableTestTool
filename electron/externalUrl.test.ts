import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { shouldOpenInSystemBrowser } = require('./externalUrl.cjs') as {
  shouldOpenInSystemBrowser: (url: string) => boolean;
};

describe('shouldOpenInSystemBrowser', () => {
  it('opens real http(s) destinations used by playable CTAs', () => {
    expect(shouldOpenInSystemBrowser('https://apps.apple.com/app/1')).toBe(true);
    expect(shouldOpenInSystemBrowser('http://example.com/path')).toBe(true);
  });

  it('does not open the local Vite / Electron preview URL', () => {
    expect(shouldOpenInSystemBrowser('http://127.0.0.1:5173/')).toBe(false);
    expect(shouldOpenInSystemBrowser('http://localhost:5173/index.html')).toBe(false);
    expect(shouldOpenInSystemBrowser('http://[::1]:5173/')).toBe(false);
  });

  it('does not open DevTools, about, or file URLs', () => {
    expect(shouldOpenInSystemBrowser('about:blank')).toBe(false);
    expect(shouldOpenInSystemBrowser('devtools://devtools/bundled/devtools_app.html')).toBe(false);
    expect(shouldOpenInSystemBrowser('file:///C:/app/index.html')).toBe(false);
    expect(shouldOpenInSystemBrowser('chrome://inspect')).toBe(false);
  });

  it('rejects empty or invalid URLs', () => {
    expect(shouldOpenInSystemBrowser('')).toBe(false);
    expect(shouldOpenInSystemBrowser('not a url')).toBe(false);
  });
});
