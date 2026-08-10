/** Values assigned to `window.curChannel` in preview. */
export const PREVIEW_CHANNELS = [
  'Google',
  'AppLovin',
  'Facebook',
  'Unity',
  'Moloco',
  'Liftoff',
  'Mintegral',
] as const;

export type PreviewChannel = (typeof PREVIEW_CHANNELS)[number];
