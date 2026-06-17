import { Alert, Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import {
	DatagridConfigurable,
	DateField,
	FilterForm,
	FunctionField,
	List,
	RefreshButton,
	SelectInput,
	TextField,
	TextInput,
	TopToolbar,
	useRefresh,
} from "react-admin";
import { Link as RouterLink } from "react-router-dom";

import { PANEL_COPY } from "../panel-copy";
import { PanelDatagridHeader } from "../panel-datagrid-header";
import { PanelListErrorState } from "../panel-list-error";
import { PANEL_LIST_SX } from "../panel-page";
import { PanelPagination } from "../panel-pagination";
import { PanelResponsiveDatagrid } from "../panel-responsive-datagrid";
import type { RequestProjectionRecord } from "../types";
import { RequestColumnSettingsButton } from "./request-column-settings-button";
import { formatCapabilityLabel, formatDuration } from "./request-formatters";
import {
	RequestActorSummary,
	RequestOutcomeSummary,
	RequestPreviewText,
	RequestScopeSummary,
	RequestStatusChip,
	RequestSurfaceLabel,
} from "./request-presenters";
import { buildRequestShowPath } from "./request-routes";

export const REQUEST_STATUS_CHOICES = [
	{ id: "accepted", name: PANEL_COPY.requestStatus.accepted },
	{ id: "completed", name: PANEL_COPY.requestStatus.completed },
	{ id: "needs_clarification", name: PANEL_COPY.requestStatus.needs_clarification },
	{ id: "approval_required", name: PANEL_COPY.requestStatus.approval_required },
	{ id: "rejected", name: PANEL_COPY.requestStatus.rejected },
	{ id: "no_answer", name: PANEL_COPY.requestStatus.no_answer },
	{ id: "error", name: PANEL_COPY.requestStatus.error },
];

const REQUEST_LIST_PREFERENCE_KEY = "requests.triage-table";

const requestFilters = [
	<TextInput
		alwaysOn
		helperText={false}
		key="q"
		label={PANEL_COPY.requestsList.searchLabel}
		placeholder={PANEL_COPY.requestsList.searchPlaceholder}
		resettable
		source="q"
	/>,
	<SelectInput
		alwaysOn
		choices={REQUEST_STATUS_CHOICES}
		emptyText={PANEL_COPY.requestsList.allStatuses}
		helperText={false}
		key="status"
		label={PANEL_COPY.requestsList.columns.status}
		source="status"
	/>,
	<TextInput
		alwaysOn
		helperText={false}
		key="conversationId"
		label={PANEL_COPY.requestsList.conversationId}
		resettable
		source="conversationId"
	/>,
];

function RequestListGuide() {
	return (
		<Alert severity="info" sx={{ alignItems: "flex-start" }}>
			<Stack spacing={0.5}>
				<Typography variant="body2">{PANEL_COPY.requestsList.intro}</Typography>
				<Typography sx={{ display: { md: "block", xs: "none" } }} variant="body2">
					{PANEL_COPY.requestsList.paginationHint}
				</Typography>
				<Typography sx={{ display: { md: "block", xs: "none" } }} variant="body2">
					{PANEL_COPY.requestsList.projectionLagHint}
				</Typography>
			</Stack>
		</Alert>
	);
}

function RequestListActions() {
	return (
		<TopToolbar
			sx={{
				alignItems: "stretch",
				alignSelf: "stretch",
				boxSizing: "border-box",
				display: "flex",
				flexDirection: "column",
				gap: 2,
				maxWidth: "100%",
				px: 0,
				whiteSpace: "normal",
				width: "100%",
			}}
		>
			<Stack
				alignItems={{ md: "center", xs: "flex-start" }}
				direction={{ md: "row", xs: "column" }}
				gap={1.5}
				justifyContent="space-between"
				sx={{ width: "100%" }}
			>
				<Stack spacing={0.25} sx={{ minWidth: 0 }}>
					<Typography fontWeight={600} variant="subtitle1">
						{PANEL_COPY.requestsList.title}
					</Typography>
					<Typography color="text.secondary" variant="body2">
						{PANEL_COPY.requestsList.summary}
					</Typography>
				</Stack>
				<Stack direction="row" flexWrap="wrap" gap={1}>
					<RequestColumnSettingsButton preferenceKey={REQUEST_LIST_PREFERENCE_KEY} />
					<RefreshButton label={PANEL_COPY.actions.refreshList} />
				</Stack>
			</Stack>
			<Box
				sx={{
					width: "100%",
					"& .RaFilterForm-form": {
						alignItems: "start",
						display: "grid",
						gap: 1,
						gridTemplateColumns: {
							lg: "minmax(320px, 2fr) minmax(180px, 1fr) minmax(220px, 1fr)",
							xs: "1fr",
						},
					},
					"& .MuiFormControl-root": {
						m: 0,
						width: "100%",
					},
				}}
			>
				<FilterForm filters={requestFilters} />
			</Box>
		</TopToolbar>
	);
}

function RequestListEmpty() {
	const refresh = useRefresh();

	return (
		<Card>
			<CardContent>
				<Stack spacing={1.5}>
					<Typography variant="h6">{PANEL_COPY.requestsList.noRequestsTitle}</Typography>
					<Typography color="text.secondary" variant="body2">
						{PANEL_COPY.requestsList.noRequestsDescription}
					</Typography>
					<Box>
						<Button onClick={() => refresh()} variant="outlined">
							{PANEL_COPY.actions.refreshList}
						</Button>
					</Box>
				</Stack>
			</CardContent>
		</Card>
	);
}

export function RequestListPage() {
	return (
		<List
			actions={<RequestListActions />}
			disableSyncWithLocation
			error={
				<PanelListErrorState
					description="请求列表加载失败。请稍后重试，或查看服务状态。"
					title="请求列表读取失败"
				/>
			}
			emptyWhileLoading
			empty={<RequestListEmpty />}
			pagination={false}
			perPage={20}
			sort={{ field: "startedAt", order: "DESC" }}
			sx={PANEL_LIST_SX}
			title={PANEL_COPY.menu.requests}
		>
			<RequestListContent />
		</List>
	);
}

function RequestListContent() {
	return (
		<Stack spacing={2}>
			<RequestListGuide />
			<PanelResponsiveDatagrid minWidth={1520}>
				<DatagridConfigurable
					bulkActionButtons={false}
					empty={<RequestListEmpty />}
					header={<PanelDatagridHeader />}
					omit={["requestId", "traceId", "conversationId", "surface", "requestedCapability"]}
					preferenceKey={REQUEST_LIST_PREFERENCE_KEY}
				>
					<DateField
						label={PANEL_COPY.requestsList.columns.startedAt}
						locales="zh-CN"
						showTime
						source="startedAt"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.status}
						render={(record: RequestProjectionRecord) => (
							<RequestStatusChip status={record.status} />
						)}
						source="status"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.question}
						render={(record: RequestProjectionRecord) => (
							<RequestPreviewText
								emptyText="未记录问题预览。"
								maxLines={2}
								text={record.questionPreview}
							/>
						)}
						source="questionPreview"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.principal}
						render={(record: RequestProjectionRecord) => <RequestActorSummary record={record} />}
						source="principalId"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.scope}
						render={(record: RequestProjectionRecord) => <RequestScopeSummary record={record} />}
						source="selectedCapability"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.outcome}
						render={(record: RequestProjectionRecord) => <RequestOutcomeSummary record={record} />}
						source="answerPreview"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.duration}
						render={(record: RequestProjectionRecord) => formatDuration(record.durationMs)}
						source="durationMs"
					/>
					<FunctionField
						label={PANEL_COPY.view}
						render={(record: RequestProjectionRecord) => (
							<Button
								component={RouterLink}
								size="small"
								to={buildRequestShowPath(record.requestId)}
							>
								{PANEL_COPY.view}
							</Button>
						)}
					/>

					<TextField label={PANEL_COPY.requestsList.columns.requestId} source="requestId" />
					<TextField label={PANEL_COPY.requestsList.columns.traceId} source="traceId" />
					<TextField
						label={PANEL_COPY.requestsList.columns.conversationId}
						source="conversationId"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.surface}
						render={(record: RequestProjectionRecord) => (
							<RequestSurfaceLabel surface={record.surface} />
						)}
						source="surface"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.capability}
						render={(record: RequestProjectionRecord) =>
							formatCapabilityLabel(record.requestedCapability)
						}
						source="requestedCapability"
					/>
				</DatagridConfigurable>
			</PanelResponsiveDatagrid>
			<PanelPagination />
		</Stack>
	);
}
