import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";
import { Datagrid, FunctionField, List, SelectInput, TextField, TextInput } from "react-admin";

import { PANEL_COPY } from "../panel-copy";
import { PanelDatagridHeader } from "../panel-datagrid-header";
import { PanelListActions } from "../panel-list-actions";
import { PanelListErrorState } from "../panel-list-error";
import { PANEL_LIST_SX } from "../panel-page";
import { PanelPagination } from "../panel-pagination";
import { PanelResponsiveDatagrid } from "../panel-responsive-datagrid";
import type { OfficialWebTargetInventoryRecord } from "../types";
import {
	OfficialWebConsumerFamilyChip,
	OfficialWebTargetInventoryReviewStateChip,
} from "./official-web-presenters";

const targetInventoryFilters = [
	<TextInput alwaysOn key="siteId" label="站点 ID" source="siteId" />,
	<SelectInput
		choices={[
			{ id: "contact_directory_candidate", name: "联系信息候选" },
			{ id: "service_guide_candidate", name: "办事指南候选" },
			{ id: "regulation_candidate", name: "公开规章候选" },
			{ id: "stable_reference_candidate", name: "稳定参考候选" },
			{ id: "notice_news_candidate", name: "通知资讯清单" },
		]}
		emptyText="全部消费族"
		key="consumerFamily"
		label="消费族"
		source="consumerFamily"
	/>,
	<SelectInput
		choices={[
			{ id: "contact_directory_lookup", name: "联系信息查询" },
			{ id: "service_guide_lookup", name: "办事指南查询" },
			{ id: "regulations/institutional_rules", name: "规章制度" },
			{ id: "official_web/stable_reference", name: "官网稳定参考" },
		]}
		emptyText="全部消费面"
		key="ownerSurface"
		label="消费面"
		source="ownerSurface"
	/>,
	<SelectInput
		choices={[
			{ id: "candidate", name: "候选" },
			{ id: "previewed", name: "已预览" },
			{ id: "blocked_fields", name: "字段阻塞" },
			{ id: "blocked_lineage", name: "血缘阻塞" },
			{ id: "blocked_source", name: "来源阻塞" },
			{ id: "inventory_only", name: "仅清单" },
			{ id: "ready_for_selected_write", name: "可进入选择写" },
			{ id: "excluded", name: "已排除" },
		]}
		emptyText="全部评审态"
		key="reviewState"
		label="评审态"
		source="reviewState"
	/>,
];

function OfficialWebTargetInventoryContractNotice() {
	return <Alert severity="info">查看页面级采集目标、字段缺口和发布准备状态。</Alert>;
}

function OfficialWebTargetInventoryEmpty() {
	return (
		<Card>
			<CardContent>
				<Stack spacing={1.5}>
					<Typography variant="h6">{PANEL_COPY.emptyState.officialWebTargetInventory}</Typography>
					<Typography color="text.secondary" variant="body2">
						当前没有可查看的官网目标清单。
					</Typography>
				</Stack>
			</CardContent>
		</Card>
	);
}

function renderList(values: string[]) {
	return values.length > 0 ? values.join(", ") : PANEL_COPY.none;
}

function renderFieldStatus(record: OfficialWebTargetInventoryRecord) {
	return Object.entries(record.fieldStatus)
		.map(([field, status]) => `${field}:${status}`)
		.join(", ");
}

function OfficialWebSelectedWriteCell({ record }: { record: OfficialWebTargetInventoryRecord }) {
	if (record.reviewState !== "ready_for_selected_write") {
		return <Typography color="text.secondary">-</Typography>;
	}

	return <Typography variant="body2">等待发布任务</Typography>;
}

export function OfficialWebTargetInventoryListPage() {
	return (
		<List
			actions={<PanelListActions />}
			disableSyncWithLocation
			empty={<OfficialWebTargetInventoryEmpty />}
			emptyWhileLoading
			error={
				<PanelListErrorState
					description="官网目标清单加载失败。请稍后重试，或查看服务状态。"
					title="官网目标清单读取失败"
				/>
			}
			filters={targetInventoryFilters}
			pagination={<PanelPagination />}
			perPage={20}
			sort={{ field: "inventoryId", order: "ASC" }}
			sx={PANEL_LIST_SX}
			title="官网目标清单"
		>
			<Stack spacing={2}>
				<OfficialWebTargetInventoryContractNotice />
				<PanelResponsiveDatagrid minWidth={1760}>
					<Datagrid
						bulkActionButtons={false}
						empty={<OfficialWebTargetInventoryEmpty />}
						header={<PanelDatagridHeader />}
					>
						<TextField label="清单 ID" source="inventoryId" />
						<TextField label="目标标签" source="targetLabel" />
						<TextField label="准入目标" source="admissionTargetId" />
						<FunctionField
							label="评审态"
							render={(record: OfficialWebTargetInventoryRecord) => (
								<OfficialWebTargetInventoryReviewStateChip record={record} />
							)}
						/>
						<FunctionField
							label="消费族"
							render={(record: OfficialWebTargetInventoryRecord) => (
								<OfficialWebConsumerFamilyChip consumerFamily={record.consumerFamily} />
							)}
						/>
						<TextField label="消费面" source="ownerSurface" />
						<TextField label="写入目标" source="selectedWriteTarget" />
						<FunctionField
							label="必需证据"
							render={(record: OfficialWebTargetInventoryRecord) =>
								renderList(record.requiredEvidence)
							}
						/>
						<FunctionField
							label="可选证据"
							render={(record: OfficialWebTargetInventoryRecord) =>
								renderList(record.optionalEvidence)
							}
						/>
						<FunctionField
							label="必需字段"
							render={(record: OfficialWebTargetInventoryRecord) =>
								renderList(record.requiredFields)
							}
						/>
						<FunctionField
							label="可选字段"
							render={(record: OfficialWebTargetInventoryRecord) =>
								renderList(record.optionalFields)
							}
						/>
						<FunctionField
							label="字段状态"
							render={(record: OfficialWebTargetInventoryRecord) => renderFieldStatus(record)}
						/>
						<FunctionField
							label="阻塞原因"
							render={(record: OfficialWebTargetInventoryRecord) =>
								renderList(record.releaseBlockers)
							}
						/>
						<FunctionField
							label="来源 URL"
							render={(record: OfficialWebTargetInventoryRecord) => renderList(record.sourceUrls)}
						/>
						<FunctionField
							label="选择写"
							render={(record: OfficialWebTargetInventoryRecord) => (
								<OfficialWebSelectedWriteCell record={record} />
							)}
						/>
					</Datagrid>
				</PanelResponsiveDatagrid>
			</Stack>
		</List>
	);
}
