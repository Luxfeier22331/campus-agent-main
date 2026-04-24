import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";
import { Datagrid, DateField, FunctionField, List, ShowButton, TextField } from "react-admin";

import { PANEL_COPY } from "../panel-copy";
import { PanelDatagridHeader } from "../panel-datagrid-header";
import { PanelListActions } from "../panel-list-actions";
import { PanelListErrorState } from "../panel-list-error";
import { PanelPagination } from "../panel-pagination";
import { PanelResponsiveDatagrid } from "../panel-responsive-datagrid";
import type { OfficialWebSiteRecord } from "../types";
import {
	OfficialWebHostsSummary,
	OfficialWebIngestionStatusChip,
	OfficialWebRunStatusChip,
} from "./official-web-presenters";

function OfficialWebSitesContractNotice() {
	return (
		<Alert severity="info">
			站点列表读取 app-api 维护的 official_web 站点投影，不会直接检查对象存储、队列或
			ingestion-worker 内部细节。
		</Alert>
	);
}

function OfficialWebSitesEmpty() {
	return (
		<Card>
			<CardContent>
				<Stack spacing={1.5}>
					<Typography variant="h6">{PANEL_COPY.emptyState.officialWebSites}</Typography>
					<Typography color="text.secondary" variant="body2">
						该读模型只展示 app-api 已经投影完成的官网站点。如果站点尚未完成投影或 staging
						仍未导入样本，这里会保持为空。
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
			empty={<OfficialWebSitesEmpty />}
			emptyWhileLoading
			error={
				<PanelListErrorState
					description="官网站点页读取的是 app-api 维护的 official_web 站点投影；如果后端查询失败，这里会直接暴露错误，而不是把失败误判为空结果。"
					title="官网站点读取失败"
				/>
			}
			pagination={<PanelPagination />}
			perPage={50}
			title="官网站点"
		>
			<Stack spacing={2}>
				<OfficialWebSitesContractNotice />
				<PanelResponsiveDatagrid minWidth={980}>
					<Datagrid
						bulkActionButtons={false}
						empty={<OfficialWebSitesEmpty />}
						header={<PanelDatagridHeader />}
						rowClick="show"
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
						<DateField label="最近成功" locales="zh-CN" showTime source="lastSuccessAt" />
						<DateField label="最近失败" locales="zh-CN" showTime source="lastFailureAt" />
						<ShowButton label={PANEL_COPY.view} />
					</Datagrid>
				</PanelResponsiveDatagrid>
			</Stack>
		</List>
	);
}
