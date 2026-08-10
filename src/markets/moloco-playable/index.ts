import type { MarketModule } from '../../types';
import { MOLOCO_PLAYABLE_LIMITS } from './limits';
import { molocoProbes, molocoRules } from './rules';

export const molocoPlayableMarket: MarketModule = {
  id: 'moloco-playable',
  labelZh: 'Moloco',
  enabled: true,
  channel: 'Moloco',
  rulesReady: true,
  limits: MOLOCO_PLAYABLE_LIMITS,
  rules: molocoRules,
  probes: molocoProbes,
};

export { MOLOCO_PLAYABLE_LIMITS } from './limits';
export { molocoRules, molocoProbes } from './rules';
