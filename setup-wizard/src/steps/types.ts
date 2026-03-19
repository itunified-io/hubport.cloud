/** Wizard step interface — each step is self-contained and idempotent. */
export interface WizardStep {
  /** Step number (1-8) */
  number: number;
  /** Machine name */
  id: string;
  /** Human-readable title */
  title: string;
  /** Short description of what this step does */
  description: string;
  /** Whether this step can be skipped (e.g., WARP is optional) */
  optional: boolean;
  /** Check current status — returns credentials/state to display */
  check: () => Promise<StepStatus>;
  /** Execute the step with user-provided input */
  execute: (input: Record<string, string>) => Promise<StepResult>;
}

export interface StepStatus {
  completed: boolean;
  details?: Record<string, string>;
}

export interface StepResult {
  success: boolean;
  message: string;
  /** Credentials to display for user confirmation */
  credentials?: Record<string, string>;
  /** Warnings that need attention */
  warnings?: string[];
  /** If set, triggers a hard-stop credential confirmation page instead of normal rendering */
  hardStop?: VaultCredentialStop;
  /** If set, triggers a second download prompt for the encryption key after Vault confirm */
  encryptionKeyDownload?: { key: string; generatedAt: string };
}

/** Data for the Vault credential hard-stop page — user must download & confirm before continuing */
export interface VaultCredentialStop {
  unsealKey: string;
  rootToken: string;
  generatedAt: string;
}
