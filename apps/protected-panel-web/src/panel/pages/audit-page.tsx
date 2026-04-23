import {
	Alert,
	Box,
	Button,
	Card,
	CardContent,
	Chip,
	Divider,
	Drawer,
	MenuItem,
	Link as MuiLink,
	Stack,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableRow,
	TextField,
	Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, startTransition, useDeferredValue, useMemo, useState } from "react";
import { Title, useAuthenticated, useDataProvider } from "react-admin";
import { Link as RouterLink } from "react-router-dom";

import type { ProtectedPanelDataProvider } from "../data-provider";
import { formatPanelTimestamp, PANEL_COPY, translateRuntimeErrorMessage } from "../panel-copy";
import {
	CURRENT_RUNTIME_TARGET_OPTIONS,
	formatCapabilityLabel,
	formatPrincipalTypeLabel,
	formatSelectedTargetLabel,
	formatSurfaceLabel,
} from "../requests/request-formatters";
import {
	buildAuditDiagnosticEntries,
	formatAuditEventType,
	formatAuditStatus,
} from "./audit-domain";

type AuditFilterState = {
	eventType: string;
	page: number;
	perPage: number;
	principalType: string;
	requestId: string;
	selectedTarget: string | null;
	status: string;
	surface: string | null;
	traceId: string;
};

const SURFACE_OPTIONS: Array<{ label: string; value: string | null }> = [
	{ label: PANEL_COPY.overviewPage.filters.allSurfaces, value: null },
	{ label: formatSurfaceLabel("public_chat_web"), value: "public_chat_web" },
	{ label: formatSurfaceLabel("protected_panel_web"), value: "protected_panel_web" },
];

const TARGET_OPTIONS: Array<{ label: string; value: string | null }> = [
	{ label: PANEL_COPY.overviewPage.filters.allTargets, value: null },
	...CURRENT_RUNTIME_TARGET_OPTIONS,
];

const PRINCIPAL_TYPE_OPTIONS = [
	{ label: PANEL_COPY.auditPage.filters.allPrincipalTypes, value: "" },
	{ label: formatPrincipalTypeLabel("operator"), value: "operator" },
	{ label: formatPrincipalTypeLabel("public_user"), value: "public_user" },
	{ label: formatPrincipalTypeLabel("campus_member"), value: "campus_member" },
	{ label: formatPrincipalTypeLabel("student"), value: "student" },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function normalizeFilterValue(value: string) {
	return value.trim() ? value.trim() : null;
}

function toQueryErrorMessage(error: unknown, fallback: string) {
	if (!error || typeof error !== "object") {
		return fallback;
	}

	const maybeError = error as {
		body?: {
			error?: {
				code?: string | null;
				message?: string | null;
			};
		};
		message?: string | null;
		statusText?: string;
	};

	return translateRuntimeErrorMessage({
		code: maybeError.body?.error?.code,
		message: maybeError.body?.error?.message ?? maybeError.message,
		statusText: maybeError.statusText,
	});
}

function SectionCard(props: { children: ReactNode; description?: string; title: string }) {
	return (
		<Card
			sx={{
				background:
					"linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(248,251,255,0.99) 100%)",
				borderRadius: 3,
			}}
			variant="outlined"
		>
			<CardContent>
				<Stack spacing={2}>
					<Stack spacing={0.75}>
						<Typography sx={{ fontWeight: 700 }} variant="h6">
							{props.title}
						</Typography>
						{props.description ? (
							<Typography color="text.secondary" variant="body2">
								{props.description}
							</Typography>
						) : null}
					</Stack>
					{props.children}
				</Stack>
			</CardContent>
		</Card>
	);
}

export function AuditPage() {
	useAuthenticated();
	const dataProvider = useDataProvider<ProtectedPanelDataProvider>();
	const [selectedEvent, setSelectedEvent] = useState<OperatorAuditEventRecord | null>(null);
	const [filters, setFilters] = useState<AuditFilterState>({
		eventType: "",
		page: 1,
		perPage: 10,
		principalType: "",
		requestId: "",
		selectedTarget: null,
		status: "",
		surface: null,
		traceId: "",
	});

	const deferredRequestId = useDeferredValue(filters.requestId);
	const deferredTraceId = useDeferredValue(filters.traceId);
	const deferredPrincipalType = useDeferredValue(filters.principalType);
	const deferredSurface = useDeferredValue(filters.surface);
	const deferredSelectedTarget = useDeferredValue(filters.selectedTarget);
	const deferredEventType = useDeferredValue(filters.eventType);
	const deferredStatus = useDeferredValue(filters.status);

	const isRefreshing =
		filters.requestId !== deferredRequestId ||
		filters.traceId !== deferredTraceId ||
		filters.principalType !== deferredPrincipalType ||
		filters.surface !== deferredSurface ||
		filters.selectedTarget !== deferredSelectedTarget ||
		filters.eventType !== deferredEventType ||
		filters.status !== deferredStatus;

	const auditListQuery = useQuery({
		queryFn: ({ signal }) =>
			dataProvider.listOperatorAudit({
				eventType: normalizeFilterValue(deferredEventType),
				page: filters.page,
				perPage: filters.perPage,
				principalType: normalizeFilterValue(deferredPrincipalType),
				requestId: normalizeFilterValue(deferredRequestId),
				selectedTarget: deferredSelectedTarget,
				signal,
				status: normalizeFilterValue(deferredStatus),
				surface: deferredSurface,
				traceId: normalizeFilterValue(deferredTraceId),
			}),
		queryKey: [
			"protected-panel-audit-list",
			filters.page,
			filters.perPage,
			deferredRequestId,
			deferredTraceId,
			deferredPrincipalType,
			deferredSurface,
			deferredSelectedTarget,
			deferredEventType,
			deferredStatus,
		] as const,
		staleTime: 15_000,
	});

	const auditDetailQuery = useQuery({
		enabled: Boolean(selectedEvent?.auditEventId),
		queryFn: ({ signal }) => {
			const auditEventId = selectedEvent?.auditEventId;
			if (!auditEventId) {
				throw new Error("auditEventId is required.");
			}
			return dataProvider.getOperatorAuditEvent({
				auditEventId,
				signal,
			});
		},
		queryKey: ["protected-panel-audit-detail", selectedEvent?.auditEventId ?? null] as const,
		staleTime: 15_000,
	});

	const auditEvents = auditListQuery.data?.data ?? [];
	const auditPageInfo = auditListQuery.data?.pageInfo;
	const selectedEventDetail = auditDetailQuery.data?.data ?? null;
	const listErrorMessage = auditListQuery.error
		? toQueryErrorMessage(auditListQuery.error, PANEL_COPY.auditPage.states.loadFailed)
		: null;
	const detailErrorMessage = auditDetailQuery.error
		? toQueryErrorMessage(auditDetailQuery.error, PANEL_COPY.auditPage.states.detailLoadFailed)
		: null;

	const filterSummaryItems = useMemo(() => {
		const items = [
			filters.requestId
				? `${PANEL_COPY.auditPage.filterSummary.requestId}: ${filters.requestId}`
				: null,
			filters.traceId ? `${PANEL_COPY.auditPage.filterSummary.traceId}: ${filters.traceId}` : null,
			filters.principalType
				? `${PANEL_COPY.auditPage.filterSummary.principalType}: ${formatPrincipalTypeLabel(filters.principalType)}`
				: null,
			filters.surface
				? `${PANEL_COPY.auditPage.filterSummary.surface}: ${formatSurfaceLabel(filters.surface)}`
				: null,
			filters.selectedTarget
				? `${PANEL_COPY.auditPage.filterSummary.selectedTarget}: ${formatSelectedTargetLabel(filters.selectedTarget)}`
				: null,
			filters.eventType
				? `${PANEL_COPY.auditPage.filterSummary.eventType}: ${filters.eventType}`
				: null,
			filters.status ? `${PANEL_COPY.auditPage.filterSummary.status}: ${filters.status}` : null,
		].filter(Boolean);

		return items.length > 0 ? items : [PANEL_COPY.auditPage.filterSummary.allEvents];
	}, [
		filters.eventType,
		filters.principalType,
		filters.requestId,
		filters.selectedTarget,
		filters.status,
		filters.surface,
		filters.traceId,
	]);

	const pageDescription = useMemo(() => {
		const start = (filters.page - 1) * filters.perPage + 1;
		const end = start + auditEvents.length - 1;

		if (auditEvents.length === 0) {
			return `第 ${filters.page} 页`;
		}

		return `${start}-${end} · 第 ${filters.page} 页`;
	}, [auditEvents.length, filters.page, filters.perPage]);

	const detailEvent = selectedEventDetail?.event ?? null;
	const detailLinks = selectedEventDetail?.links ?? null;
	const diagnosticEntries = detailEvent ? buildAuditDiagnosticEntries(detailEvent.diagnostics) : [];

	return (
		<>
			<Title title={PANEL_COPY.menu.audit} />
			<Box sx={{ p: { md: 3, xs: 2 } }}>
				<Stack spacing={3}>
					<Card
						sx={{
							background:
								"linear-gradient(135deg, rgba(247,251,255,1) 0%, rgba(235,244,255,1) 100%)",
							borderRadius: 4,
						}}
						variant="outlined"
					>
						<CardContent>
							<Stack spacing={2.5}>
								<Stack spacing={1}>
									<Typography sx={{ fontWeight: 700 }} variant="h4">
										{PANEL_COPY.auditPage.title}
									</Typography>
									<Typography color="text.secondary" variant="body1">
										{PANEL_COPY.auditPage.subtitle}
									</Typography>
								</Stack>

								<Stack
									direction={{ md: "row", xs: "column" }}
									spacing={1.5}
									sx={{ alignItems: { md: "center", xs: "stretch" }, flexWrap: "wrap" }}
								>
									<TextField
										label={PANEL_COPY.auditPage.filters.requestId}
										onChange={(event) => {
											startTransition(() => {
												setFilters((current) => ({
													...current,
													page: 1,
													requestId: event.target.value,
												}));
											});
										}}
										size="small"
										value={filters.requestId}
									/>
									<TextField
										label={PANEL_COPY.auditPage.filters.traceId}
										onChange={(event) => {
											startTransition(() => {
												setFilters((current) => ({
													...current,
													page: 1,
													traceId: event.target.value,
												}));
											});
										}}
										size="small"
										value={filters.traceId}
									/>
									<TextField
										label={PANEL_COPY.auditPage.filters.principalType}
										onChange={(event) => {
											startTransition(() => {
												setFilters((current) => ({
													...current,
													page: 1,
													principalType: event.target.value,
												}));
											});
										}}
										select
										size="small"
										value={filters.principalType}
									>
										{PRINCIPAL_TYPE_OPTIONS.map((option) => (
											<MenuItem key={option.value || "all"} value={option.value}>
												{option.label}
											</MenuItem>
										))}
									</TextField>
									<TextField
										label={PANEL_COPY.auditPage.filters.surface}
										onChange={(event) => {
											startTransition(() => {
												setFilters((current) => ({
													...current,
													page: 1,
													surface: normalizeFilterValue(event.target.value),
												}));
											});
										}}
										select
										size="small"
										value={filters.surface ?? ""}
									>
										{SURFACE_OPTIONS.map((option) => (
											<MenuItem key={option.value ?? "all"} value={option.value ?? ""}>
												{option.label}
											</MenuItem>
										))}
									</TextField>
									<TextField
										label={PANEL_COPY.auditPage.filters.selectedTarget}
										onChange={(event) => {
											startTransition(() => {
												setFilters((current) => ({
													...current,
													page: 1,
													selectedTarget: normalizeFilterValue(event.target.value),
												}));
											});
										}}
										select
										size="small"
										value={filters.selectedTarget ?? ""}
									>
										{TARGET_OPTIONS.map((option) => (
											<MenuItem key={option.value ?? "all"} value={option.value ?? ""}>
												{option.label}
											</MenuItem>
										))}
									</TextField>
									<TextField
										label={PANEL_COPY.auditPage.filters.eventType}
										onChange={(event) => {
											startTransition(() => {
												setFilters((current) => ({
													...current,
													eventType: event.target.value,
													page: 1,
												}));
											});
										}}
										size="small"
										value={filters.eventType}
									/>
									<TextField
										label={PANEL_COPY.auditPage.filters.status}
										onChange={(event) => {
											startTransition(() => {
												setFilters((current) => ({
													...current,
													page: 1,
													status: event.target.value,
												}));
											});
										}}
										size="small"
										value={filters.status}
									/>
								</Stack>

								<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
									{filterSummaryItems.map((item) => (
										<Chip key={item} label={item} size="small" variant="outlined" />
									))}
									{isRefreshing ? (
										<Chip
											color="info"
											label={PANEL_COPY.auditPage.refreshing}
											size="small"
											variant="outlined"
										/>
									) : null}
								</Stack>
							</Stack>
						</CardContent>
					</Card>

					<SectionCard
						description={PANEL_COPY.auditPage.sections.timelineDescription}
						title={PANEL_COPY.auditPage.sections.timeline}
					>
						<Stack spacing={1.5}>
							<Typography color="text.secondary" variant="body2">
								{PANEL_COPY.auditPage.timeline.queueHint}
							</Typography>
							<Typography color="text.secondary" variant="body2">
								{pageDescription}
							</Typography>

							{listErrorMessage ? <Alert severity="error">{listErrorMessage}</Alert> : null}

							{!listErrorMessage && auditListQuery.isPending ? (
								<Alert severity="info">{PANEL_COPY.auditPage.states.loading}</Alert>
							) : null}

							{!(listErrorMessage || auditListQuery.isPending) && auditEvents.length === 0 ? (
								<Alert severity="info">{PANEL_COPY.auditPage.timeline.empty}</Alert>
							) : null}

							{auditEvents.length > 0 ? (
								<Box sx={{ overflowX: "auto" }}>
									<Table size="small">
										<TableHead>
											<TableRow>
												<TableCell>{PANEL_COPY.auditPage.columns.occurredAt}</TableCell>
												<TableCell>{PANEL_COPY.auditPage.columns.eventType}</TableCell>
												<TableCell>{PANEL_COPY.auditPage.columns.summary}</TableCell>
												<TableCell>{PANEL_COPY.auditPage.columns.requestId}</TableCell>
												<TableCell>{PANEL_COPY.auditPage.columns.status}</TableCell>
												<TableCell>{PANEL_COPY.auditPage.columns.surface}</TableCell>
												<TableCell>{PANEL_COPY.auditPage.columns.principalType}</TableCell>
												<TableCell>{PANEL_COPY.auditPage.columns.selectedTarget}</TableCell>
												<TableCell>{PANEL_COPY.auditPage.columns.actions}</TableCell>
											</TableRow>
										</TableHead>
										<TableBody>
											{auditEvents.map((event) => (
												<TableRow hover key={event.auditEventId}>
													<TableCell>{formatPanelTimestamp(event.occurredAt)}</TableCell>
													<TableCell>{formatAuditEventType(event.eventType)}</TableCell>
													<TableCell sx={{ minWidth: 280 }}>{event.summary}</TableCell>
													<TableCell>{event.requestId}</TableCell>
													<TableCell>{formatAuditStatus(event.status)}</TableCell>
													<TableCell>{formatSurfaceLabel(event.surface)}</TableCell>
													<TableCell>{formatPrincipalTypeLabel(event.principalType)}</TableCell>
													<TableCell>{formatSelectedTargetLabel(event.selectedTarget)}</TableCell>
													<TableCell>
														<Stack direction="row" spacing={1}>
															<Button
																onClick={() => setSelectedEvent(event)}
																size="small"
																variant="outlined"
															>
																{PANEL_COPY.auditPage.timeline.viewDetail}
															</Button>
															<Button
																component={RouterLink}
																size="small"
																to={`/requests/${event.requestId}/show`}
															>
																{PANEL_COPY.auditPage.timeline.viewRequest}
															</Button>
														</Stack>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</Box>
							) : null}

							<Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
								<TextField
									label={PANEL_COPY.pagination.rowsPerPage}
									onChange={(event) => {
										startTransition(() => {
											setFilters((current) => ({
												...current,
												page: 1,
												perPage: Number(event.target.value),
											}));
										});
									}}
									select
									size="small"
									value={String(filters.perPage)}
								>
									{PAGE_SIZE_OPTIONS.map((option) => (
										<MenuItem key={option} value={String(option)}>
											{option}
										</MenuItem>
									))}
								</TextField>
								<Button
									disabled={filters.page === 1}
									onClick={() => {
										startTransition(() => {
											setFilters((current) => ({
												...current,
												page: Math.max(1, current.page - 1),
											}));
										});
									}}
									variant="outlined"
								>
									{PANEL_COPY.auditPage.timeline.previousPage}
								</Button>
								<Button
									disabled={!auditPageInfo?.hasNextPage}
									onClick={() => {
										startTransition(() => {
											setFilters((current) => ({
												...current,
												page: current.page + 1,
											}));
										});
									}}
									variant="contained"
								>
									{PANEL_COPY.auditPage.timeline.nextPage}
								</Button>
							</Stack>
						</Stack>
					</SectionCard>
				</Stack>
			</Box>

			<Drawer
				anchor="right"
				onClose={() => setSelectedEvent(null)}
				open={Boolean(selectedEvent)}
				PaperProps={{
					sx: {
						width: {
							md: 480,
							xs: "100%",
						},
					},
				}}
			>
				<Box sx={{ p: 3 }}>
					<Stack spacing={2.5}>
						<Stack spacing={1}>
							<Stack direction="row" justifyContent="space-between" spacing={2}>
								<Typography sx={{ fontWeight: 700 }} variant="h6">
									{detailEvent
										? formatAuditEventType(detailEvent.eventType)
										: selectedEvent
											? formatAuditEventType(selectedEvent.eventType)
											: PANEL_COPY.auditPage.sections.detail}
								</Typography>
								<Button onClick={() => setSelectedEvent(null)} size="small">
									{PANEL_COPY.auditPage.detail.closeDetail}
								</Button>
							</Stack>
							<Typography color="text.secondary" variant="body2">
								{detailEvent?.summary ?? selectedEvent?.summary ?? PANEL_COPY.pending}
							</Typography>
						</Stack>

						{detailErrorMessage ? <Alert severity="error">{detailErrorMessage}</Alert> : null}
						{!detailErrorMessage && auditDetailQuery.isPending ? (
							<Alert severity="info">{PANEL_COPY.auditPage.states.detailLoading}</Alert>
						) : null}

						<SectionCard title={PANEL_COPY.auditPage.detail.requestMeta}>
							<Stack spacing={0.75}>
								<Typography variant="body2">
									<strong>{PANEL_COPY.auditPage.columns.requestId}</strong>:{" "}
									{detailEvent?.requestId ?? selectedEvent?.requestId ?? PANEL_COPY.pending}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.auditPage.detail.traceId}</strong>:{" "}
									{detailEvent?.traceId ?? selectedEvent?.traceId ?? PANEL_COPY.pending}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.auditPage.columns.occurredAt}</strong>:{" "}
									{formatPanelTimestamp(
										detailEvent?.occurredAt ?? selectedEvent?.occurredAt ?? null,
									)}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.auditPage.columns.eventType}</strong>:{" "}
									{formatAuditEventType(detailEvent?.eventType ?? selectedEvent?.eventType ?? "")}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.auditPage.columns.status}</strong>:{" "}
									{formatAuditStatus(detailEvent?.status ?? selectedEvent?.status ?? "")}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.auditPage.detail.terminalCode}</strong>:{" "}
									{detailEvent?.terminalCode
										? formatAuditStatus(detailEvent.terminalCode)
										: PANEL_COPY.notAvailable}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.auditPage.columns.principalType}</strong>:{" "}
									{formatPrincipalTypeLabel(
										detailEvent?.principalType ?? selectedEvent?.principalType ?? "",
									)}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.auditPage.detail.requestedCapability}</strong>:{" "}
									{formatCapabilityLabel(detailEvent?.requestedCapability ?? null)}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.auditPage.columns.selectedTarget}</strong>:{" "}
									{formatSelectedTargetLabel(
										detailEvent?.selectedTarget ?? selectedEvent?.selectedTarget ?? null,
									)}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.auditPage.detail.entitlementSnapshotId}</strong>:{" "}
									{detailEvent?.entitlementSnapshotId ?? PANEL_COPY.notAvailable}
								</Typography>
								<Typography variant="body2">
									<strong>{PANEL_COPY.auditPage.detail.policyProjectionVersion}</strong>:{" "}
									{detailEvent?.policyProjectionVersion ?? PANEL_COPY.notAvailable}
								</Typography>
							</Stack>
						</SectionCard>

						<Divider />

						<SectionCard title={PANEL_COPY.auditPage.detail.diagnostics}>
							{diagnosticEntries.length > 0 ? (
								<Stack spacing={0.75}>
									{diagnosticEntries.map((entry) => (
										<Typography key={entry.label} variant="body2">
											<strong>{entry.label}</strong>: {entry.value}
										</Typography>
									))}
								</Stack>
							) : (
								<Typography color="text.secondary" variant="body2">
									{PANEL_COPY.auditPage.detail.noDiagnostics}
								</Typography>
							)}
						</SectionCard>

						<SectionCard title={PANEL_COPY.auditPage.detail.links}>
							<Stack spacing={1.25}>
								<Button
									component={RouterLink}
									size="small"
									to={`/requests/${detailEvent?.requestId ?? selectedEvent?.requestId ?? ""}/show`}
									variant="contained"
								>
									{PANEL_COPY.auditPage.timeline.viewRequest}
								</Button>
								{detailLinks?.traceLink ? (
									<MuiLink href={detailLinks.traceLink} rel="noreferrer" target="_blank">
										{PANEL_COPY.auditPage.detail.traceLink}
									</MuiLink>
								) : null}
								{detailLinks?.issueLink ? (
									<MuiLink href={detailLinks.issueLink} rel="noreferrer" target="_blank">
										{PANEL_COPY.auditPage.detail.issueLink}
									</MuiLink>
								) : null}
								{detailLinks?.issueFingerprint ? (
									<Typography color="text.secondary" variant="body2">
										{PANEL_COPY.auditPage.detail.issueFingerprint}: {detailLinks.issueFingerprint}
									</Typography>
								) : null}
								{detailLinks?.traceLink ||
								detailLinks?.issueLink ||
								detailLinks?.issueFingerprint ? null : (
									<Typography color="text.secondary" variant="body2">
										{PANEL_COPY.auditPage.detail.noLinks}
									</Typography>
								)}
							</Stack>
						</SectionCard>
					</Stack>
				</Box>
			</Drawer>
		</>
	);
}
