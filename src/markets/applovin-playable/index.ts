import type { MarketModule } from '../../types';
import { APPLOVIN_PLAYABLE_LIMITS } from './limits';
import { applovinProbes, applovinRules } from './rules';

export const applovinPlayableMarket: MarketModule = {
  id: 'applovin-playable',
  labelZh: 'AppLovin Playable',
  enabled: true,
  channel: 'AppLovin',
  limits: APPLOVIN_PLAYABLE_LIMITS,
  rules: applovinRules,
  probes: applovinProbes,
};
