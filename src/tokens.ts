/** DI tokens. The domain classes carry no decorators, so Nest wires them through factory providers. */
export const TOKENS = {
  CONFIG: 'DS_CONFIG',
  EVENTS: 'DS_EVENTS',
  ANALYSES: 'DS_ANALYSES',
  BASELINES: 'DS_BASELINES',
  AI: 'DS_AI',
} as const;
