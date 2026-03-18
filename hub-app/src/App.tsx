import { Routes, Route, Navigate } from "react-router";
import { useAuth } from "./auth/useAuth";
import { RoleGuard } from "./auth/RoleGuard";
import { Layout } from "./components/Layout";
import { LoadingSpinner } from "./components/LoadingSpinner";
import { Dashboard } from "./pages/Dashboard";
import { PublisherList } from "./pages/publishers/PublisherList";
import { PublisherForm } from "./pages/publishers/PublisherForm";
import { TerritoryList } from "./pages/territories/TerritoryList";
import { TerritoryMap } from "./pages/territories/TerritoryMap";
import { MeetingList } from "./pages/meetings/MeetingList";
import { MeetingForm } from "./pages/meetings/MeetingForm";
import { Settings } from "./pages/settings/Settings";
import { SharingPartners } from "./pages/sharing/SharingPartners";
import { FormattedMessage } from "react-intl";

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

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />

        <Route
          path="/publishers"
          element={
            <RoleGuard requiredRole="elder">
              <PublisherList />
            </RoleGuard>
          }
        />
        <Route
          path="/publishers/new"
          element={
            <RoleGuard requiredRole="elder">
              <PublisherForm />
            </RoleGuard>
          }
        />
        <Route
          path="/publishers/:id"
          element={
            <RoleGuard requiredRole="elder">
              <PublisherForm />
            </RoleGuard>
          }
        />

        <Route
          path="/territories"
          element={
            <RoleGuard requiredRole="elder">
              <TerritoryList />
            </RoleGuard>
          }
        />
        <Route
          path="/territories/map"
          element={
            <RoleGuard requiredRole="elder">
              <TerritoryMap />
            </RoleGuard>
          }
        />

        <Route path="/meetings" element={<MeetingList />} />
        <Route
          path="/meetings/new"
          element={
            <RoleGuard requiredRole="elder">
              <MeetingForm />
            </RoleGuard>
          }
        />
        <Route
          path="/meetings/:id"
          element={
            <RoleGuard requiredRole="elder">
              <MeetingForm />
            </RoleGuard>
          }
        />

        <Route
          path="/sharing"
          element={
            <RoleGuard requiredRole="admin">
              <SharingPartners />
            </RoleGuard>
          }
        />

        <Route
          path="/settings"
          element={
            <RoleGuard requiredRole="admin">
              <Settings />
            </RoleGuard>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
