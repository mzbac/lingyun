import type { LLMProvider } from '../core/types';
import type { ModelInfo } from './copilot';

export interface ProviderAuthStatus {
  supported: boolean;
  authenticated: boolean;
  status: 'hidden' | 'signed_out' | 'signed_in';
  label: string;
  detail?: string;
  accountLabel?: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
}

export interface ProviderAuthUiState extends ProviderAuthStatus {
  providerId: string;
  providerName: string;
}

export type LLMProviderWithUi = LLMProvider & {
  getModels?: () => Promise<ModelInfo[]>;
  clearModelCache?: () => void;
  getAuthStatus?: () => Promise<ProviderAuthStatus>;
  authenticate?: () => Promise<void>;
  disconnect?: () => Promise<void>;
};
