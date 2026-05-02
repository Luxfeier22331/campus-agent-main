import AssignmentTurnedInOutlinedIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import FindInPageOutlinedIcon from "@mui/icons-material/FindInPageOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LanguageOutlinedIcon from "@mui/icons-material/LanguageOutlined";
import MarkEmailReadOutlinedIcon from "@mui/icons-material/MarkEmailReadOutlined";
import PendingActionsOutlinedIcon from "@mui/icons-material/PendingActionsOutlined";
import RuleFolderOutlinedIcon from "@mui/icons-material/RuleFolderOutlined";
import TravelExploreOutlinedIcon from "@mui/icons-material/TravelExploreOutlined";
import { Admin, CustomRoutes, Resource } from "react-admin";
import { Navigate, Route } from "react-router-dom";

import { protectedPanelAuthProvider } from "./auth-provider";
import { AuthenticatedNoticeProcessingListPage } from "./authenticated-notices/processing-list";
import { AuthenticatedNoticeProcessingShowPage } from "./authenticated-notices/processing-show";
import { AuthenticatedNoticeRunProcessingListPage } from "./authenticated-notices/run-processing-list";
import { AuthenticatedNoticeRunProcessingShowPage } from "./authenticated-notices/run-processing-show";
import { protectedPanelDataProvider } from "./data-provider";
import { OfficialWebReleaseTaskShowPage } from "./official-web/release-task-show";
import { OfficialWebReleaseTasksListPage } from "./official-web/release-tasks-list";
import { OfficialWebRunShowPage } from "./official-web/run-show";
import { OfficialWebRunsListPage } from "./official-web/runs-list";
import { OfficialWebSiteShowPage } from "./official-web/site-show";
import { OfficialWebSitesListPage } from "./official-web/sites-list";
import { OfficialWebTargetInventoryListPage } from "./official-web/target-inventory-list";
import { OfficialWebTargetJobShowPage } from "./official-web/target-job-show";
import { OfficialWebTargetJobsListPage } from "./official-web/target-jobs-list";
import { AccessRequiredPage } from "./pages/access-required-page";
import { AuditPage } from "./pages/audit-page";
import { CostPage } from "./pages/cost-page";
import { DelayedDomainPage } from "./pages/delayed-domain-page";
import { IntentPage } from "./pages/intent-page";
import { OverviewPage } from "./pages/overview-page";
import { QualityPage } from "./pages/quality-page";
import { SafetyPage } from "./pages/safety-page";
import { PANEL_COPY } from "./panel-copy";
import { ProtectedPanelLayout } from "./panel-layout";
import { protectedPanelTheme } from "./panel-theme";
import { RequestListPage } from "./requests/request-list";
import { RequestShowPage } from "./requests/request-show";

function OverviewLandingRedirect() {
	return <Navigate replace to="/observability/overview" />;
}

export function ProtectedPanelAdminApp() {
	return (
		<Admin
			authProvider={protectedPanelAuthProvider}
			dashboard={OverviewLandingRedirect}
			dataProvider={protectedPanelDataProvider}
			disableTelemetry
			layout={ProtectedPanelLayout}
			loginPage={AccessRequiredPage}
			theme={protectedPanelTheme}
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
				icon={MarkEmailReadOutlinedIcon}
				list={AuthenticatedNoticeProcessingListPage}
				name="authenticatedNoticeProcessing"
				options={{ label: PANEL_COPY.menu.authenticatedNoticeProcessing }}
				recordRepresentation="noticeId"
				show={AuthenticatedNoticeProcessingShowPage}
			/>
			<Resource
				icon={PendingActionsOutlinedIcon}
				list={AuthenticatedNoticeRunProcessingListPage}
				name="authenticatedNoticeRunProcessing"
				options={{ label: PANEL_COPY.menu.authenticatedNoticeRunProcessing }}
				recordRepresentation="collectorRunToken"
				show={AuthenticatedNoticeRunProcessingShowPage}
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
				icon={RuleFolderOutlinedIcon}
				list={OfficialWebTargetJobsListPage}
				name="officialWebTargetJobs"
				options={{ label: PANEL_COPY.menu.officialWebTargetJobs }}
				recordRepresentation="targetId"
				show={OfficialWebTargetJobShowPage}
			/>
			<Resource
				icon={Inventory2OutlinedIcon}
				list={OfficialWebTargetInventoryListPage}
				name="officialWebTargetInventory"
				options={{ label: PANEL_COPY.menu.officialWebTargetInventory }}
				recordRepresentation="inventoryId"
			/>
			<Resource
				icon={AssignmentTurnedInOutlinedIcon}
				list={OfficialWebReleaseTasksListPage}
				name="officialWebReleaseTasks"
				options={{ label: PANEL_COPY.menu.officialWebReleaseTasks }}
				recordRepresentation="taskId"
				show={OfficialWebReleaseTaskShowPage}
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
				<Route element={<OverviewPage />} path="/observability/overview" />
				<Route element={<QualityPage />} path="/observability/quality" />
				<Route element={<IntentPage />} path="/observability/intent" />
				<Route element={<SafetyPage />} path="/observability/safety" />
				<Route element={<CostPage />} path="/observability/cost" />
				<Route element={<AuditPage />} path="/observability/audit" />
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
				<Route element={<Navigate replace to="/observability/audit" />} path="/audit" />
			</CustomRoutes>
		</Admin>
	);
}
