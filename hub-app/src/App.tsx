import { Routes, Route, Navigate } from "react-router";
import { useAuth } from "./auth/useAuth";
import { OfflineProvider } from "./providers/OfflineProvider";
import { PermissionGuard} from "./auth/PermissionGuard";
import { Layout } from "./components/Layout";
import { LoadingSpinner } from "./components/LoadingSpinner";
import { MyDevices } from "./pages/profile/MyDevices";
import { DeviceAdmin } from "./pages/settings/DeviceAdmin";
import { NotificationSettings } from "./pages/settings/NotificationSettings";
import { Dashboard } from "./pages/Dashboard";
import { PublisherList } from "./pages/publishers/PublisherList";
import { PublisherForm } from "./pages/publishers/PublisherForm";
import { ServiceGroups } from "./pages/publishers/ServiceGroups";
import { TerritoryList } from "./pages/territories/TerritoryList";
import { TerritoryDetail } from "./pages/territories/TerritoryDetail";
import { TerritoryMap } from "./pages/territories/TerritoryMap";
import { ImportWizard } from "./pages/territories/ImportWizard";
import { KanbanBoard } from "./pages/territories/KanbanBoard";
import { CampaignList } from "./pages/territories/CampaignList";
import { CampaignForm } from "./pages/territories/CampaignForm";
import { CampaignDetail } from "./pages/territories/CampaignDetail";
import { CampaignReport } from "./pages/territories/CampaignReport";
import { MeetingPointList } from "./pages/field-service/MeetingPointList";
import { MeetingPointForm } from "./pages/field-service/MeetingPointForm";
import { MeetingPointDetail } from "./pages/field-service/MeetingPointDetail";
import { ServiceGroupPlanning } from "./pages/field-service/ServiceGroupPlanning";
import { ServiceMeetingDetail } from "./pages/field-service/ServiceMeetingDetail";
import { GapDetection } from "./pages/territories/GapDetection";
import ShareRedeemPage from "./pages/territories/ShareRedeemPage";
import FieldWorkMode from "./pages/territories/FieldWorkMode";
import FieldWorkDashboard from "./pages/territories/FieldWorkDashboard";
import { MeetingList } from "./pages/meetings/MeetingList";
import { MeetingForm } from "./pages/meetings/MeetingForm";
import { MidweekPlanner } from "./pages/meetings/planner/MidweekPlanner";
import { WeekendPlanner } from "./pages/meetings/planner/WeekendPlanner";
import { PublicTalkPlanner } from "./pages/meetings/planner/PublicTalkPlanner";
import { Settings } from "./pages/settings/Settings";
import { SharingPartners } from "./pages/sharing/SharingPartners";
import { RoleList } from "./pages/users/RoleList";
import { RoleDetail } from "./pages/users/RoleDetail";
import { AuditLog } from "./pages/audit/AuditLog";
import { FacilitiesPage } from "./pages/facilities/FacilitiesPage";
import { CleaningTab } from "./pages/facilities/CleaningTab";
import { GroundsTab } from "./pages/facilities/GroundsTab";
import { MaintenanceTab } from "./pages/facilities/MaintenanceTab";
import { PreventiveTab } from "./pages/facilities/PreventiveTab";
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

  // Public route: shared territory view (no auth required)
  if (window.location.pathname.startsWith("/shared/t/")) {
    return <ShareRedeemPage />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <OfflineProvider>
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
          path="/territories/import"
          element={
            <PermissionGuard requires="app:territories.import">
              <ImportWizard />
            </PermissionGuard>
          }
        />
        <Route
          path="/territories/kanban"
          element={
            <PermissionGuard requires="app:territories.view">
              <KanbanBoard />
            </PermissionGuard>
          }
        />
        {/* Old campaign routes → redirect to new field-service paths */}
        <Route path="/territories/campaigns" element={<Navigate to="/field-service/campaigns" replace />} />
        <Route path="/territories/campaigns/new" element={<Navigate to="/field-service/campaigns/new" replace />} />
        <Route path="/territories/campaigns/:id" element={<Navigate to="/field-service/campaigns/:id" replace />} />

        <Route
          path="/territories/gap-detection"
          element={
            <PermissionGuard requires="app:territories.view">
              <GapDetection />
            </PermissionGuard>
          }
        />
        <Route
          path="/territories/field-work"
          element={
            <PermissionGuard requires="app:field_work.overseer">
              <FieldWorkDashboard />
            </PermissionGuard>
          }
        />
        <Route
          path="/territories/:id/field-work"
          element={
            <PermissionGuard requires="app:field_work.gps">
              <FieldWorkMode />
            </PermissionGuard>
          }
        />
        <Route
          path="/territories/:id"
          element={
            <PermissionGuard requires="app:territories.view">
              <TerritoryDetail />
            </PermissionGuard>
          }
        />

        {/* Field Service (Predigtdienst) */}
        <Route
          path="/field-service/campaigns"
          element={
            <PermissionGuard requires="app:campaigns.view">
              <CampaignList />
            </PermissionGuard>
          }
        />
        <Route
          path="/field-service/campaigns/new"
          element={
            <PermissionGuard requires="app:campaigns.manage">
              <CampaignForm />
            </PermissionGuard>
          }
        />
        <Route
          path="/field-service/campaigns/:id"
          element={
            <PermissionGuard requires="app:campaigns.view">
              <CampaignDetail />
            </PermissionGuard>
          }
        />
        <Route
          path="/field-service/campaigns/:id/report"
          element={
            <PermissionGuard requires="app:campaigns.view">
              <CampaignReport />
            </PermissionGuard>
          }
        />
        <Route
          path="/field-service/meeting-points"
          element={
            <PermissionGuard requires="app:meeting_points.view">
              <MeetingPointList />
            </PermissionGuard>
          }
        />
        <Route
          path="/field-service/meeting-points/new"
          element={
            <PermissionGuard requires="app:meeting_points.manage">
              <MeetingPointForm />
            </PermissionGuard>
          }
        />
        <Route
          path="/field-service/meeting-points/:id"
          element={
            <PermissionGuard requires="app:meeting_points.view">
              <MeetingPointDetail />
            </PermissionGuard>
          }
        />
        <Route
          path="/field-service/groups"
          element={
            <PermissionGuard requires="app:service_meetings.view">
              <ServiceGroupPlanning />
            </PermissionGuard>
          }
        />
        <Route
          path="/field-service/groups/:meetingId"
          element={
            <PermissionGuard requires="app:service_meetings.view">
              <ServiceMeetingDetail />
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

        {/* Meeting Planning */}
        <Route
          path="/meetings/planner"
          element={
            <PermissionGuard requires={["app:meeting_assignments.view", "manage:midweek_program"]} any>
              <MidweekPlanner />
            </PermissionGuard>
          }
        />
        <Route
          path="/meetings/weekend"
          element={
            <PermissionGuard requires={["app:meeting_assignments.view", "manage:weekend_program"]} any>
              <WeekendPlanner />
            </PermissionGuard>
          }
        />
        <Route
          path="/meetings/public-talks"
          element={
            <PermissionGuard requires={["app:public_talks.view", "manage:public_talks"]} any>
              <PublicTalkPlanner />
            </PermissionGuard>
          }
        />

        {/* Facilities (Cleaning & Maintenance) */}
        <Route
          path="/facilities"
          element={
            <PermissionGuard requires="app:facilities.view">
              <FacilitiesPage />
            </PermissionGuard>
          }
        >
          <Route path="cleaning" element={<CleaningTab />} />
          <Route path="grounds" element={<GroundsTab />} />
          <Route path="maintenance" element={<MaintenanceTab />} />
          <Route path="preventive" element={<PreventiveTab />} />
        </Route>
        <Route path="/cleaning" element={<Navigate to="/facilities/cleaning" replace />} />

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
        <Route path="/profile/devices" element={<MyDevices />} />

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
            <PermissionGuard requires="app:sharing.view">
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
        <Route
          path="/settings/devices"
          element={
            <PermissionGuard requires="app:admin.devices.view">
              <DeviceAdmin />
            </PermissionGuard>
          }
        />

        <Route
          path="/settings/notifications"
          element={
            <PermissionGuard requires="app:devices.view">
              <NotificationSettings />
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
    </OfflineProvider>
  );
}
