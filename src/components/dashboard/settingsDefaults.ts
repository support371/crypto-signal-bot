import type { UserSettings } from '@/components/dashboard/SettingsModal';

export const DEFAULT_SETTINGS: UserSettings = {
  riskTolerance: 0.5,
  volatilitySensitivity: 0.5,
  positionSizeFraction: 0.1,
  spreadStressThreshold: 0.002,
  autoTradeEnabled: false,
  soundAlertsEnabled: true,
  backendApiKey: '',
};
