import { type ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { ChatWidget } from "./chat/ChatWidget";
import { UpdateBanner } from "./UpdateBanner";

interface LayoutProps {
  children: ReactNode;
}

function getTenantName(): string {
  const subdomain =
    (window as unknown as Record<string, unknown>).__HUBPORT_SUBDOMAIN__ as string | undefined;
  if (subdomain) return subdomain;
  // Fallback: try to read from hostname (e.g., penzberg-north-uat.hubport.cloud)
  const host = window.location.hostname;
  if (host.endsWith(".hubport.cloud")) {
    return host.replace(".hubport.cloud", "");
  }
  return "Hubport";
}

export function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const tenantName = getTenantName();

  return (
    <div className="min-h-dvh flex bg-[var(--bg)]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed z-40 top-0 left-0 h-full w-60 bg-[var(--bg-1)] border-r border-[var(--border)] flex flex-col transition-transform lg:translate-x-0 lg:static lg:z-auto ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-14 flex items-center px-4 border-b border-[var(--border)]">
          <span className="text-[var(--amber)] font-bold text-lg tracking-wide">
            {tenantName}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto pt-2">
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Update banner — sits above everything else */}
        <UpdateBanner />
        <Header onMenuToggle={() => setSidebarOpen((o) => !o)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>

      {/* Chat widget — bottom-right popup */}
      <ChatWidget />
    </div>
  );
}
