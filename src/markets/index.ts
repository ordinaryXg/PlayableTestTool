import type { MarketModule } from '../types';
import { googleAppPlayableMarket } from './google-app-playable';
import { applovinPlayableMarket } from './applovin-playable';
import { facebookPlayableMarket } from './facebook-playable';
import { unityPlayableMarket } from './unity-playable';
import { molocoPlayableMarket } from './moloco-playable';
import { mintegralPlayableMarket } from './mintegral-playable';
import type { PreviewChannel } from '../preview/channels';

/** Channel preview only: injects curChannel; no market-specific rules yet. */
const channelPreviewMarket = (
  id: string,
  channel: PreviewChannel,
): MarketModule => ({
  id,
  labelZh: channel,
  enabled: true,
  channel,
  rulesReady: false,
  limits: googleAppPlayableMarket.limits,
  rules: [],
  probes: googleAppPlayableMarket.probes,
});

const markets: MarketModule[] = [
  { ...googleAppPlayableMarket, channel: 'Google', labelZh: 'Google', rulesReady: true },
  { ...applovinPlayableMarket, channel: 'AppLovin', labelZh: 'AppLovin', rulesReady: true },
  { ...facebookPlayableMarket, labelZh: 'Facebook', rulesReady: true },
  { ...unityPlayableMarket, labelZh: 'Unity', rulesReady: true },
  molocoPlayableMarket,
  mintegralPlayableMarket,
  channelPreviewMarket('liftoff-playable', 'Liftoff'),
];

export function listMarkets(): MarketModule[] {
  return markets;
}

export function getMarket(id: string): MarketModule {
  return markets.find((m) => m.id === id) ?? markets[0]!;
}

/** Short name for UI / reports (channel id). */
export function marketDisplayName(m: MarketModule): string {
  return m.channel;
}

/** Dropdown label: channel only; unfinished markets marked. */
export function marketSelectLabel(m: MarketModule): string {
  if (m.rulesReady === false) return `${m.channel}（未接入）`;
  return m.channel;
}

export function isMarketRulesReady(m: MarketModule): boolean {
  return m.rulesReady !== false;
}

export const DEFAULT_MARKET_ID = googleAppPlayableMarket.id;
