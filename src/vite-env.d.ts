/// <reference types="vite/client" />

import type { PvDesktopApi } from './desktop/api';

declare global {
  interface Window {
    pvDesktop?: PvDesktopApi;
  }
}

export {};
