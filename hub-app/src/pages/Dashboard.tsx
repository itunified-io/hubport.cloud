import { FormattedMessage } from "react-intl";
import { Users, Map, Calendar } from "lucide-react";
import { useAuth } from "@/auth/useAuth";

interface StatCardProps {
  icon: React.ElementType;
  labelId: string;
  value: string | number;
  color: string;
}

function StatCard({ icon: Icon, labelId, value, color }: StatCardProps) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-1)] p-5">
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center w-10 h-10 rounded-[var(--radius-sm)]"
          style={{ backgroundColor: `${color}14` }}
        >
          <Icon size={20} style={{ color }} />
        </div>
        <div>
          <p className="text-2xl font-bold text-[var(--text)]">{value}</p>
          <p className="text-xs text-[var(--text-muted)]">
            <FormattedMessage id={labelId} />
          </p>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { displayName } = useAuth();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[var(--text)]">
        <FormattedMessage id="dashboard.welcome" values={{ name: displayName }} />
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          icon={Users}
          labelId="dashboard.publishers"
          value={0}
          color="var(--blue)"
        />
        <StatCard
          icon={Map}
          labelId="dashboard.territories"
          value={0}
          color="var(--green)"
        />
        <StatCard
          icon={Calendar}
          labelId="dashboard.meetings"
          value={0}
          color="var(--amber)"
        />
      </div>
    </div>
  );
}
