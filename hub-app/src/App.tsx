import { Routes, Route, Navigate } from "react-router";
import { useAuth } from "./auth/useAuth";
import { SecurityGate } from "./auth/SecurityGate";
import { PermissionGuard } from "./auth/PermissionGuard";
import { Layout } from "./components/Layout";
import { LoadingSpinner } from "./components/LoadingSpinner";
import { Dashboard } from "./pages/Dashboard";
import { PublisherList } from "./pages/publishers/PublisherList";
import { PublisherForm } from "./pages/publishers/PublisherForm";
import { ServiceGroups } from "./pages/publishers/ServiceGroups";
import { TerritoryList } from "./pages/territories/TerritoryList";
import { TerritoryMap } from "./pages/territories/TerritoryMap";
import { MeetingList } from "./pages/meetings/MeetingList";
import { MeetingForm } from "./pages/meetings/MeetingForm";
import { Settings } from "./pages/settings/Settings";
import { SharingPartners } from "./pages/sharing/SharingPartners";
import { RoleList } from "./pages/users/RoleList";
import { RoleDetail } from "./pages/users/RoleDetail";
import { AuditLog } from "./pages/audit/AuditLog";
import { CleaningDashboard } from "./pages/cleaning/CleaningDashboard";
// Chat is now a global widget in Layout.tsx (ChatWidget), not a page route
import { Profile } from "./pages/profile/Profile";
import { FormattedMessage } from "react-intl";
import { InviteWizard } from "./pages/invite/InviteWizard";

function LoginPage() {
  const { signIn } = useAuth();

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[var(--bg)]">
      <div className="text-center space-y-6">
        <h1 className="text-3xl font-bold text-[var(--amber)]">Hubport</h1>
        <p className="text-[var(--text-muted)]">Congregation Management</p>
        <button
          onClick={() => signIn()}
          className="px-6 py-3 bg-[var(--amber)] text-black font-semibold rounded-[var(--radius)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
        >
          <FormattedMessage id="auth.login" />
        </button>
      </div>
    </div>
  );
}

export function App() {
  const { isAuthenticated, isLoading, error } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[var(--bg)]">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[var(--bg)]">
        <div className="text-center space-y-4">
          <p className="text-[var(--red)]">Authentication Error</p>
          <p className="text-[var(--text-muted)] text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  // Public route: invite signup wizard (no auth required)
  if (window.location.pathname.startsWith("/invite")) {
    return <InviteWizard />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <SecurityGate>
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />

        {/* Publishers (unified — replaces old /users pages) */}
        <Route
          path="/publishers"
          element={
            <PermissionGuard requires={["app:publishers.view", "app:publishers.view_minimal"]} any>
              <PublisherList />
            </PermissionGuard>
          }
        />
        <Route
          path="/publishers/new"
          element={
            <PermissionGuard requires="app:publishers.edit">
              <PublisherForm />
            </PermissionGuard>
          }
        />
        <Route
          path="/publishers/service-groups"
          element={
            <PermissionGuard requires="app:publishers.view">
              <ServiceGroups />
            </PermissionGuard>
          }
        />
        <Route
          path="/publishers/:id"
          element={
            <PermissionGuard requires={["app:publishers.view", "app:publishers.view_minimal"]} any>
              <PublisherForm />
            </PermissionGuard>
          }
        />

        <Route
          path="/territories"
          element={
            <PermissionGuard requires="app:territories.view">
              <TerritoryList />
            </PermissionGuard>
          }
        />
        <Route
          path="/territories/map"
          element={
            <PermissionGuard requires="app:territories.view">
              <TerritoryMap />
            </PermissionGuard>
          }
        />

        <Route
          path="/meetings"
          element={
            <PermissionGuard requires="app:meetings.view">
              <MeetingList />
            </PermissionGuard>
          }
        />
        <Route
          path="/meetings/new"
          element={
            <PermissionGuard requires="app:meetings.edit">
              <MeetingForm />
            </PermissionGuard>
          }
        />
        <Route
          path="/meetings/:id"
          element={
            <PermissionGuard requires="app:meetings.edit">
              <MeetingForm />
            </PermissionGuard>
          }
        />

        {/* Cleaning & Garden */}
        <Route
          path="/cleaning"
          element={
            <PermissionGuard requires="app:cleaning.view">
              <CleaningDashboard />
            </PermissionGuard>
          }
        />

        {/* Chat is now a global widget (ChatWidget in Layout), not a routed page */}

        {/* Role Management (moved from /users/roles to /settings/roles) */}
        <Route
          path="/settings/roles"
          element={
            <PermissionGuard requires="app:roles.edit">
              <RoleList />
            </PermissionGuard>
          }
        />
        <Route
          path="/settings/roles/:id"
          element={
            <PermissionGuard requires="app:roles.edit">
              <RoleDetail />
            </PermissionGuard>
          }
        />

        {/* Profile (any authenticated user) */}
        <Route path="/profile" element={<Profile />} />

        {/* Audit Log */}
        <Route
          path="/audit"
          element={
            <PermissionGuard requires="app:audit.view">
              <AuditLog />
            </PermissionGuard>
          }
        />

        <Route
          path="/sharing"
          element={
            <PermissionGuard requires="app:settings.view">
              <SharingPartners />
            </PermissionGuard>
          }
        />
        <Route
          path="/settings"
          element={
            <PermissionGuard requires="app:settings.view">
              <Settings />
            </PermissionGuard>
          }
        />

        {/* Backward compatibility redirects */}
        <Route path="/users" element={<Navigate to="/publishers" replace />} />
        <Route path="/users/roles" element={<Navigate to="/settings/roles" replace />} />
        <Route path="/users/roles/:id" element={<Navigate to="/settings/roles" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
    </SecurityGate>
  );
}
