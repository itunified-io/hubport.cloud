import { FormattedMessage } from "react-intl";
import { Settings as SettingsIcon, Server, Shield, Bell } from "lucide-react";

interface SettingsSectionProps {
  icon: React.ElementType;
  title: string;
  description: string;
}

function SettingsSection({ icon: Icon, title, description }: SettingsSectionProps) {
  return (
    <div className="flex items-start gap-4 p-5 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] hover:border-[var(--border-2)] transition-colors">
      <div className="flex items-center justify-center w-10 h-10 rounded-[var(--radius-sm)] bg-[var(--glass-2)]">
        <Icon size={20} className="text-[var(--text-muted)]" />
      </div>
      <div>
        <h3 className="text-sm font-medium text-[var(--text)]">{title}</h3>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{description}</p>
      </div>
    </div>
  );
}

export function Settings() {
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
