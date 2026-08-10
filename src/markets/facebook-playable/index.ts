import type { MarketModule } from '../../types';
import { FACEBOOK_PLAYABLE_LIMITS } from './limits';
import { facebookProbes, facebookRules } from './rules';

export const facebookPlayableMarket: MarketModule = {
  id: 'facebook-playable',
  labelZh: 'Facebook / Meta Playable',
  enabled: true,
  channel: 'Facebook',
  limits: FACEBOOK_PLAYABLE_LIMITS,
  rules: facebookRules,
  probes: facebookProbes,
};

export { FACEBOOK_PLAYABLE_LIMITS, FACEBOOK_HTML_MAX_BYTES } from './limits';
export { facebookRules, facebookProbes } from './rules';
