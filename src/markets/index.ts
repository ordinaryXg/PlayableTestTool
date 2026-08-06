import type { MarketModule } from '../types';
import { googleAppPlayableMarket } from './google-app-playable';

const placeholder = (id: string, labelZh: string): MarketModule => ({
  id,
  labelZh,
  enabled: false,
  limits: googleAppPlayableMarket.limits,
  rules: [],
  probes: [],
});

const markets: MarketModule[] = [
  googleAppPlayableMarket,
  placeholder('meta-playable', 'Meta Playable（即将支持）'),
  placeholder('tiktok-playable', 'TikTok Playable（即将支持）'),
  placeholder('unity-playable', 'Unity Ads Playable（即将支持）'),
];

export function listMarkets(): MarketModule[] {
  return markets;
}

export function getMarket(id: string): MarketModule {
  return markets.find((m) => m.id === id) ?? googleAppPlayableMarket;
}

export const DEFAULT_MARKET_ID = googleAppPlayableMarket.id;
