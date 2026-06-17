import { Alert, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { Datagrid, DateField, FunctionField, List, TextField } from "react-admin";
import { Link as RouterLink } from "react-router-dom";

import { PANEL_COPY } from "../panel-copy";
import { PanelDatagridHeader } from "../panel-datagrid-header";
import { PanelListActions } from "../panel-list-actions";
import { PanelListErrorState } from "../panel-list-error";
import { PANEL_LIST_SX } from "../panel-page";
import { PanelPagination } from "../panel-pagination";
import { PanelResponsiveDatagrid } from "../panel-responsive-datagrid";
import type { OfficialWebSiteRecord } from "../types";
import {
	OfficialWebHostsSummary,
	OfficialWebIngestionStatusChip,
	OfficialWebRunStatusChip,
} from "./official-web-presenters";
import { buildOfficialWebSiteShowPath } from "./official-web-routes";

function OfficialWebSitesContractNotice() {
	return <Alert severity="info">查看官网站点、最近采集状态和内容更新时间。</Alert>;
}

function OfficialWebSitesEmpty() {
	return (
		<Card>
			<CardContent>
				<Stack spacing={1.5}>
					<Typography variant="h6">{PANEL_COPY.emptyState.officialWebSites}</Typography>
					<Typography color="text.secondary" variant="body2">
						当前没有可查看的官网站点。
					</Typography>
				</Stack>
			</CardContent>
		</Card>
	);
}

export function OfficialWebSitesListPage() {
	return (
		<List
			actions={<PanelListActions />}
			disableSyncWithLocation
			empty={<OfficialWebSitesEmpty />}
			emptyWhileLoading
			error={
				<PanelListErrorState
					description="官网站点加载失败。请稍后重试，或查看服务状态。"
					title="官网站点读取失败"
				/>
			}
			pagination={<PanelPagination />}
			perPage={50}
			sx={PANEL_LIST_SX}
			title="官网站点"
		>
			<Stack spacing={2}>
				<OfficialWebSitesContractNotice />
				<PanelResponsiveDatagrid minWidth={1380}>
					<Datagrid
						bulkActionButtons={false}
						empty={<OfficialWebSitesEmpty />}
						header={<PanelDatagridHeader />}
					>
						<TextField label="站点 ID" source="siteId" />
						<TextField label="显示名称" source="displayName" />
						<FunctionField
							label="主机"
							render={(record: OfficialWebSiteRecord) => (
								<OfficialWebHostsSummary hostRoots={record.hostRoots} />
							)}
						/>
						<TextField label="最近运行" source="latestRunId" />
						<FunctionField
							label="最近状态"
							render={(record: OfficialWebSiteRecord) =>
								record.latestRunStatus ? (
									<OfficialWebRunStatusChip status={record.latestRunStatus} />
								) : (
									PANEL_COPY.noRuns
								)
							}
						/>
						<FunctionField
							label="分发"
							render={(record: OfficialWebSiteRecord) => (
								<OfficialWebIngestionStatusChip status={record.latestIngestionDispatchStatus} />
							)}
						/>
						<FunctionField
							label="执行"
							render={(record: OfficialWebSiteRecord) => (
								<OfficialWebIngestionStatusChip status={record.latestIngestionExecutionStatus} />
							)}
						/>
						<DateField label="最近成功" locales="zh-CN" showTime source="lastSuccessAt" />
						<DateField label="最近失败" locales="zh-CN" showTime source="lastFailureAt" />
						<FunctionField
							label={PANEL_COPY.view}
							render={(record: OfficialWebSiteRecord) => (
								<Button
									component={RouterLink}
									size="small"
									to={buildOfficialWebSiteShowPath(record.siteId)}
								>
									{PANEL_COPY.view}
								</Button>
							)}
						/>
					</Datagrid>
				</PanelResponsiveDatagrid>
			</Stack>
		</List>
	);
}
