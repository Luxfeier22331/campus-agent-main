import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import FindInPageOutlinedIcon from "@mui/icons-material/FindInPageOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import PendingActionsOutlinedIcon from "@mui/icons-material/PendingActionsOutlined";
import RuleFolderOutlinedIcon from "@mui/icons-material/RuleFolderOutlined";
import { type ReactNode } from "react";
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
import { DelayedDomainPage } from "./pages/delayed-domain-page";
import { OverviewPage } from "./pages/overview-page";
import { RequestListPage } from "./requests/request-list";
import { RequestShowPage } from "./requests/request-show";

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
      dashboard={OverviewPage}
      dataProvider={protectedPanelDataProvider}
      layout={ProtectedPanelLayout}
      loginPage={AccessRequiredPage}
      title="Protected Panel"
    >
      <Resource
        icon={FindInPageOutlinedIcon}
        list={RequestListPage}
        name="requests"
        options={{ label: "Requests" }}
        recordRepresentation="requestId"
        show={RequestShowPage}
      />
      <CustomRoutes>
        <Route
          element={
            <DelayedDomainPage
              domain="Jobs"
              reason="Jobs stays delayed until the runtime exposes a governed job projection API instead of direct queue or object-store inspection."
            />
          }
          path="/jobs"
        />
        <Route
          element={
            <DelayedDomainPage
              domain="Operations"
              reason="Operations remains deferred until the operator action model is reopened with audited, contract-first runtime endpoints."
            />
          }
          path="/operations"
        />
        <Route
          element={
            <DelayedDomainPage
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
