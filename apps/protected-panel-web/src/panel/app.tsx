import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import FindInPageOutlinedIcon from "@mui/icons-material/FindInPageOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import LanguageOutlinedIcon from "@mui/icons-material/LanguageOutlined";
import PendingActionsOutlinedIcon from "@mui/icons-material/PendingActionsOutlined";
import RuleFolderOutlinedIcon from "@mui/icons-material/RuleFolderOutlined";
import TravelExploreOutlinedIcon from "@mui/icons-material/TravelExploreOutlined";
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
import { DelayedDomainPage } from "./pages/delayed-domain-page";
import { OverviewPage } from "./pages/overview-page";
import { PANEL_COPY } from "./panel-copy";
import { OfficialWebRunShowPage } from "./official-web/run-show";
import { OfficialWebRunsListPage } from "./official-web/runs-list";
import { OfficialWebSiteShowPage } from "./official-web/site-show";
import { OfficialWebSitesListPage } from "./official-web/sites-list";
import { AccessRequiredPage } from "./pages/access-required-page";
import { RequestListPage } from "./requests/request-list";
import { RequestShowPage } from "./requests/request-show";

function ProtectedPanelMenu() {
  return (
    <Menu>
      <Menu.Item leftIcon={<DashboardOutlinedIcon />} primaryText={PANEL_COPY.menu.overview} to="/" />
      <Menu.ResourceItem name="requests" />
      <Menu.Item
        leftIcon={<LanguageOutlinedIcon />}
        primaryText={PANEL_COPY.menu.officialWebSites}
        to="/officialWebSites"
      />
      <Menu.Item
        leftIcon={<TravelExploreOutlinedIcon />}
        primaryText={PANEL_COPY.menu.officialWebRuns}
        to="/officialWebRuns"
      />
      <Menu.Item leftIcon={<RuleFolderOutlinedIcon />} primaryText={PANEL_COPY.menu.jobs} to="/jobs" />
      <Menu.Item
        leftIcon={<PendingActionsOutlinedIcon />}
        primaryText={PANEL_COPY.menu.operations}
        to="/operations"
      />
      <Menu.Item leftIcon={<HistoryOutlinedIcon />} primaryText={PANEL_COPY.menu.audit} to="/audit" />
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
      disableTelemetry
      layout={ProtectedPanelLayout}
      loginPage={AccessRequiredPage}
      title={PANEL_COPY.appTitle}
    >
      <Resource
        icon={FindInPageOutlinedIcon}
        list={RequestListPage}
        name="requests"
        options={{ label: PANEL_COPY.menu.requests }}
        recordRepresentation="requestId"
        show={RequestShowPage}
      />
      <Resource
        icon={LanguageOutlinedIcon}
        list={OfficialWebSitesListPage}
        name="officialWebSites"
        options={{ label: PANEL_COPY.menu.officialWebSites }}
        recordRepresentation="siteId"
        show={OfficialWebSiteShowPage}
      />
      <Resource
        icon={TravelExploreOutlinedIcon}
        list={OfficialWebRunsListPage}
        name="officialWebRuns"
        options={{ label: PANEL_COPY.menu.officialWebRuns }}
        recordRepresentation="runId"
        show={OfficialWebRunShowPage}
      />
      <CustomRoutes>
        <Route
          element={
            <DelayedDomainPage
              domain={PANEL_COPY.menu.jobs}
              reason="任务域暂缓开放，直到运行时提供受治理的任务投影接口，而不是直接暴露队列或对象存储内部细节。"
            />
          }
          path="/jobs"
        />
        <Route
          element={
            <DelayedDomainPage
              domain={PANEL_COPY.menu.operations}
              reason="操作域暂缓开放，直到运维动作模型以带审计、契约优先的运行时接口重新定义。"
            />
          }
          path="/operations"
        />
        <Route
          element={
            <DelayedDomainPage
              domain={PANEL_COPY.menu.audit}
              reason="审计域暂缓开放，后续应通过投影 API 提供，而不是在面板中直接暴露原始日志或遥测 sink。"
            />
          }
          path="/audit"
        />
      </CustomRoutes>
    </Admin>
  );
}
