import { useState } from "react";
import { FormattedMessage } from "react-intl";
import { Settings as SettingsIcon, Server, Shield, Bell, ArrowUpCircle, Copy, Check, Terminal } from "lucide-react";
import { getAppVersion } from "@/lib/config";

interface SettingsSectionProps {
  icon: React.ElementType;
  title: string;
  description: string;
  children?: React.ReactNode;
}

function SettingsSection({ icon: Icon, title, description, children }: SettingsSectionProps) {
  return (
    <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] hover:border-[var(--border-2)] transition-colors">
      <div className="flex items-start gap-4 p-5">
        <div className="flex items-center justify-center w-10 h-10 rounded-[var(--radius-sm)] bg-[var(--glass-2)]">
          <Icon size={20} className="text-[var(--text-muted)]" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium text-[var(--text)]">{title}</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{description}</p>
        </div>
      </div>
      {children && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-[var(--glass-2)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
      title="Copy to clipboard"
    >
      {copied ? <Check size={14} className="text-[var(--green)]" /> : <Copy size={14} />}
    </button>
  );
}

const UPDATE_CMD_BASH = "curl -fsSL https://get.hubport.cloud/update | bash";
const UPDATE_CMD_PS = "irm https://get.hubport.cloud/update/windows | iex";

export function Settings() {
  const appVersion = getAppVersion();

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <SettingsIcon size={20} className="text-[var(--amber)]" />
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="settings.title" />
        </h1>
      </div>

      <div className="space-y-3">
        <SettingsSection
          icon={ArrowUpCircle}
          title="Application Update"
          description={`Current version: v${appVersion}. Run the update command on your server to pull the latest version.`}
        >
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Terminal size={12} className="text-[var(--text-muted)]" />
                <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Linux / macOS</span>
              </div>
              <div className="flex items-center gap-2 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2">
                <code className="text-xs text-[var(--amber)] font-mono flex-1 select-all">{UPDATE_CMD_BASH}</code>
                <CopyButton text={UPDATE_CMD_BASH} />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Terminal size={12} className="text-[var(--text-muted)]" />
                <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Windows (PowerShell)</span>
              </div>
              <div className="flex items-center gap-2 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2">
                <code className="text-xs text-[var(--amber)] font-mono flex-1 select-all">{UPDATE_CMD_PS}</code>
                <CopyButton text={UPDATE_CMD_PS} />
              </div>
            </div>
            <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
              The update script pulls the latest Docker images, applies database migrations, and restarts all services.
              All data is preserved — no data loss. No vault keys required.
            </p>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={Server}
          title="Central Hub Connection"
          description="Configure the connection to the central hub API server."
        />
        <SettingsSection
          icon={Shield}
          title="Authentication"
          description="Manage OIDC provider settings and role mappings."
        />
        <SettingsSection
          icon={Bell}
          title="Notifications"
          description="Configure push notifications and alert preferences."
        />
      </div>
    </div>
  );
}
