import type { MarketModule } from '../../types';
import { MINTEGRAL_PLAYABLE_LIMITS } from './limits';
import { mintegralProbes, mintegralRules } from './rules';

export const mintegralPlayableMarket: MarketModule = {
  id: 'mintegral-playable',
  labelZh: 'Mintegral',
  enabled: true,
  channel: 'Mintegral',
  rulesReady: true,
  limits: MINTEGRAL_PLAYABLE_LIMITS,
  rules: mintegralRules,
  probes: mintegralProbes,
};

export { MINTEGRAL_PLAYABLE_LIMITS } from './limits';
export { mintegralRules, mintegralProbes } from './rules';
