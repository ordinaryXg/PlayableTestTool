import type { MarketModule } from '../../types';
import { UNITY_PLAYABLE_LIMITS } from './limits';
import { unityProbes, unityRules } from './rules';

export const unityPlayableMarket: MarketModule = {
  id: 'unity-playable',
  labelZh: 'Unity Ads Playable',
  enabled: true,
  channel: 'Unity',
  limits: UNITY_PLAYABLE_LIMITS,
  rules: unityRules,
  probes: unityProbes,
};

export { UNITY_PLAYABLE_LIMITS } from './limits';
export { unityRules, unityProbes } from './rules';
