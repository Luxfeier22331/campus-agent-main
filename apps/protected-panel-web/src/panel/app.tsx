import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import FindInPageOutlinedIcon from "@mui/icons-material/FindInPageOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import PendingActionsOutlinedIcon from "@mui/icons-material/PendingActionsOutlined";
import RuleFolderOutlinedIcon from "@mui/icons-material/RuleFolderOutlined";
import {
  lazy,
  Suspense,
  type ComponentProps,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import {
  Admin,
  CustomRoutes,
  Layout,
  Menu,
  Resource,
} from "react-admin";
import { Route } from "react-router-dom";

import { protectedPanelAuthProvider } from "./auth-provider";
import { protectedPanelDataProvider } from "./data-provider";
import { AccessRequiredPage } from "./pages/access-required-page";

const OverviewPage = lazy(async () => {
  const module = await import("./pages/overview-page");

  return {
    default: module.OverviewPage,
  };
});

const DelayedDomainPage = lazy(async () => {
  const module = await import("./pages/delayed-domain-page");

  return {
    default: module.DelayedDomainPage,
  };
});

const RequestListPage = lazy(async () => {
  const module = await import("./requests/request-list");

  return {
    default: module.RequestListPage,
  };
});

const RequestShowPage = lazy(async () => {
  const module = await import("./requests/request-show");

  return {
    default: module.RequestShowPage,
  };
});

const SuspendedOverviewPage = withPanelPageSuspense(OverviewPage);
const SuspendedRequestListPage = withPanelPageSuspense(RequestListPage);
const SuspendedRequestShowPage = withPanelPageSuspense(RequestShowPage);
const SuspendedDelayedDomainPage = withPanelPageSuspense(DelayedDomainPage);

function ProtectedPanelMenu() {
  return (
    <Menu>
      <Menu.Item leftIcon={<DashboardOutlinedIcon />} primaryText="Overview" to="/" />
      <Menu.ResourceItem name="requests" />
      <Menu.Item leftIcon={<RuleFolderOutlinedIcon />} primaryText="Jobs" to="/jobs" />
      <Menu.Item
        leftIcon={<PendingActionsOutlinedIcon />}
        primaryText="Operations"
        to="/operations"
      />
      <Menu.Item leftIcon={<HistoryOutlinedIcon />} primaryText="Audit" to="/audit" />
    </Menu>
  );
}

function ProtectedPanelLayout({ children }: { children: ReactNode }) {
  return <Layout menu={ProtectedPanelMenu}>{children}</Layout>;
}

export function ProtectedPanelAdminApp() {
  return (
    <Admin
      authProvider={protectedPanelAuthProvider}
      dashboard={SuspendedOverviewPage}
      dataProvider={protectedPanelDataProvider}
      layout={ProtectedPanelLayout}
      loginPage={AccessRequiredPage}
      title="Protected Panel"
    >
      <Resource
        icon={FindInPageOutlinedIcon}
        list={SuspendedRequestListPage}
        name="requests"
        options={{ label: "Requests" }}
        recordRepresentation="requestId"
        show={SuspendedRequestShowPage}
      />
      <CustomRoutes>
        <Route
          element={
            <SuspendedDelayedDomainPage
              domain="Jobs"
              reason="Jobs stays delayed until the runtime exposes a governed job projection API instead of direct queue or object-store inspection."
            />
          }
          path="/jobs"
        />
        <Route
          element={
            <SuspendedDelayedDomainPage
              domain="Operations"
              reason="Operations remains deferred until the operator action model is reopened with audited, contract-first runtime endpoints."
            />
          }
          path="/operations"
        />
        <Route
          element={
            <SuspendedDelayedDomainPage
              domain="Audit"
              reason="Audit is intentionally held behind a future projection API instead of exposing raw logs or telemetry sinks through the panel."
            />
          }
          path="/audit"
        />
      </CustomRoutes>
    </Admin>
  );
}

function PanelPageFallback() {
  return <div className="panel-route-fallback">Loading panel page...</div>;
}

function withPanelPageSuspense<Props extends object>(
  LazyComponent: LazyExoticComponent<ComponentType<Props>>,
) {
  return function SuspendedPanelPage(props: Props) {
    return (
      <Suspense fallback={<PanelPageFallback />}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}
