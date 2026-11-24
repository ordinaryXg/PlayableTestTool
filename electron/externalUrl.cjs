/**
 * Decide whether a window.open / new-window URL should leave Electron
 * and open in the system browser.
 *
 * Local Vite URLs, about:, and DevTools schemes must stay inside the app;
 * otherwise every `npm run dev` launch also pops Edge/Chrome.
 */
function shouldOpenInSystemBrowser(url) {
  if (typeof url !== 'string' || !url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1') {
    return false;
  }
  return true;
}

module.exports = { shouldOpenInSystemBrowser };
