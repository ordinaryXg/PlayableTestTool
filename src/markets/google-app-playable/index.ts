import type { MarketModule } from '../../types';
import { GOOGLE_APP_PLAYABLE_LIMITS } from './limits';
import { allStructureAndSizeRules } from './rules/structureSize';
import { allPolicyAndToolingRules } from './rules/policyTooling';
import { googleProbes } from './probes';

export const googleAppPlayableMarket: MarketModule = {
  id: 'google-app-playable',
  labelZh: 'Google App Campaigns / Playable',
  enabled: true,
  limits: GOOGLE_APP_PLAYABLE_LIMITS,
  rules: [...allStructureAndSizeRules(), ...allPolicyAndToolingRules()],
  probes: googleProbes,
};
