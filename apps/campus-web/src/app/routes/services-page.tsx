import { Table } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCampusTransportStatus } from "@/features/campus-services/api";
import type {
	CampusTransportDeparture,
	CampusTransportDepartureKind,
	CampusTransportDepartureStatus,
	CampusTransportRoute,
	CampusTransportStatusGroup,
	CampusTransportStatusResponse,
} from "@/features/campus-services/model";

const departureStatusLabels: Record<CampusTransportDepartureStatus, string> = {
	added: "加开",
	cancelled: "取消",
	changed: "调整",
	delayed: "延迟",
	normal: "正常",
};

const departureKindLabels: Record<CampusTransportDepartureKind, string> = {
	other: "其他",
	student: "学生班次",
	teacher: "教师班次",
};

const groupKindLabels: Record<CampusTransportStatusGroup["kind"], string> = {
	daily: "每日运行",
	temporary: "临时安排",
	weekday: "工作日运行",
	weekend_holiday: "周末/节假日运行",
};

type ScheduleTableColumnId = "departureTime" | "note" | "status" | "type";

interface ScheduleTableColumn {
	id: ScheduleTableColumnId;
	isRowHeader?: boolean;
	label: string;
}

const scheduleTableColumns: readonly ScheduleTableColumn[] = [
	{ id: "departureTime", isRowHeader: true, label: "发车时间" },
	{ id: "type", label: "班次" },
	{ id: "status", label: "状态" },
	{ id: "note", label: "备注" },
] as const;

export function ServicesPage() {
	const [schedulePayload, setSchedulePayload] = useState<CampusTransportStatusResponse | null>(
		null,
	);
	const [isScheduleLoading, setIsScheduleLoading] = useState(true);
	const [scheduleError, setScheduleError] = useState<string | null>(null);

	useEffect(() => {
		let isMounted = true;
		setIsScheduleLoading(true);
		getCampusTransportStatus()
			.then((nextPayload) => {
				if (!isMounted) {
					return;
				}
				setSchedulePayload(nextPayload);
				setScheduleError(null);
			})
			.catch(() => {
				if (isMounted) {
					setSchedulePayload(null);
					setScheduleError("班车时刻表暂时无法读取。");
				}
			})
			.finally(() => {
				if (isMounted) {
					setIsScheduleLoading(false);
				}
			});
		return () => {
			isMounted = false;
		};
	}, []);

	return (
		<section className="mx-auto max-w-[1440px] px-5 py-6 pb-24 lg:px-6">
			<div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<h1 className="text-3xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
						班车时刻表
					</h1>
					<p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--sys-text-muted)]">
						展示已发布的校车班车时间和临时调整来源。
					</p>
				</div>
			</div>

			<div className="grid gap-6">
				<TransportScheduleSection
					error={scheduleError}
					isLoading={isScheduleLoading}
					payload={schedulePayload}
				/>
			</div>
		</section>
	);
}

function TransportScheduleSection({
	error,
	isLoading,
	payload,
}: {
	error: string | null;
	isLoading: boolean;
	payload: CampusTransportStatusResponse | null;
}) {
	const adjustmentCount = countDepartureAdjustments(payload);
	const adjustmentSummary = adjustmentCount > 0 ? `含 ${adjustmentCount} 条变更` : "暂无变更";
	const sourceRefs = useMemo(() => collectSourceRefs(payload), [payload]);
	return (
		<section aria-labelledby="transport-schedule-heading" className="grid gap-4">
			<div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
				<div>
					<h2
						className="text-xl font-semibold tracking-normal text-[var(--sys-text-strong)]"
						id="transport-schedule-heading"
					>
						班车时刻表
					</h2>
					{payload ? (
						<p className="mt-1 text-xs leading-5 text-[var(--sys-text-muted)]">
							发布于 {formatDisplayDateTime(payload.release.publishedAt)} ·{" "}
							{payload.release.releaseId}
						</p>
					) : null}
				</div>
				<Badge className="h-9 px-3" variant={adjustmentCount > 0 ? "default" : "secondary"}>
					{adjustmentSummary}
				</Badge>
			</div>

			{error ? <Alert variant="destructive">{error}</Alert> : null}
			{isLoading ? <TransportScheduleSkeleton /> : null}
			{!(isLoading || error) && payload && payload.groups.length === 0 ? (
				<Alert>当前暂无可展示班次。</Alert>
			) : null}
			{!(isLoading || error) && payload && payload.groups.length > 0 ? (
				<div className="grid gap-5">
					{payload.groups.map((group) => (
						<TransportScheduleGroupSection group={group} key={group.kind} />
					))}
				</div>
			) : null}
			{sourceRefs.length > 0 ? (
				<div className="grid gap-2 text-sm">
					<p className="font-medium text-[var(--sys-text-strong)]">来源</p>
					<div className="flex flex-wrap gap-x-4 gap-y-2">
						{sourceRefs.map((url) => (
							<a
								className="font-medium text-[var(--sys-text-link)] underline-offset-4 hover:underline"
								href={url}
								key={url}
								rel="noreferrer"
								target="_blank"
							>
								{url}
							</a>
						))}
					</div>
				</div>
			) : null}
		</section>
	);
}

function TransportScheduleGroupSection({ group }: { group: CampusTransportStatusGroup }) {
	return (
		<section aria-labelledby={`transport-group-${group.kind}`} className="grid gap-4">
			<h3
				className="text-base font-semibold tracking-normal text-[var(--sys-text-strong)]"
				id={`transport-group-${group.kind}`}
			>
				{groupKindLabels[group.kind]}
			</h3>
			<div className="grid gap-5">
				{group.routes.map((route) => (
					<TransportRouteTable key={route.routeId} route={route} />
				))}
			</div>
		</section>
	);
}

function TransportRouteTable({ route }: { route: CampusTransportRoute }) {
	const rows = route.departures.map((departure, index) => ({
		...departure,
		rowId: `${route.routeId}:${index}:${departure.departureTime}`,
	}));
	return (
		<section aria-labelledby={`transport-route-${route.routeId}`} className="grid gap-3">
			<h4
				className="text-sm font-semibold tracking-normal text-[var(--sys-text-strong)]"
				id={`transport-route-${route.routeId}`}
			>
				{route.displayName}
			</h4>
			{rows.length > 0 ? (
				<Table className="rounded-lg border border-border bg-white shadow-none" variant="secondary">
					<Table.ScrollContainer>
						<Table.Content aria-label={`${route.displayName}班车时刻表`}>
							<Table.Header columns={scheduleTableColumns}>
								{(column) => (
									<Table.Column id={column.id} isRowHeader={column.isRowHeader}>
										{column.label}
									</Table.Column>
								)}
							</Table.Header>
							<Table.Body items={rows}>
								{(departure) => (
									<TransportDepartureRow departure={departure} rowId={departure.rowId} />
								)}
							</Table.Body>
						</Table.Content>
					</Table.ScrollContainer>
				</Table>
			) : (
				<Alert>当前路线暂无可展示班次。</Alert>
			)}
		</section>
	);
}

function TransportDepartureRow({
	departure,
	rowId,
}: {
	departure: CampusTransportDeparture;
	rowId: string;
}) {
	return (
		<Table.Row columns={scheduleTableColumns} id={rowId}>
			{(column) => (
				<Table.Cell textValue={getDepartureCellText(departure, column.id)}>
					{renderDepartureCell(departure, column.id)}
				</Table.Cell>
			)}
		</Table.Row>
	);
}

function renderDepartureCell(departure: CampusTransportDeparture, columnId: ScheduleTableColumnId) {
	if (columnId === "departureTime") {
		return (
			<p className="min-w-[96px] font-mono text-base font-semibold tabular-nums text-[var(--sys-text-strong)]">
				{departure.departureTime}
			</p>
		);
	}
	if (columnId === "type") {
		return (
			<p className="min-w-[88px] text-sm text-[var(--sys-text-muted)]">
				{departureKindLabels[departure.kind]}
			</p>
		);
	}
	if (columnId === "status") {
		return (
			<Badge variant={departure.status === "normal" ? "secondary" : "default"}>
				{departureStatusLabels[departure.status]}
			</Badge>
		);
	}
	return (
		<p className="min-w-[180px] max-w-xl text-sm leading-6 text-[var(--sys-text-muted)]">
			{departure.note ?? "—"}
		</p>
	);
}

function getDepartureCellText(
	departure: CampusTransportDeparture,
	columnId: ScheduleTableColumnId,
): string {
	if (columnId === "departureTime") {
		return departure.departureTime;
	}
	if (columnId === "type") {
		return departureKindLabels[departure.kind];
	}
	if (columnId === "status") {
		return departureStatusLabels[departure.status];
	}
	return departure.note ?? "—";
}

function TransportScheduleSkeleton() {
	return (
		<Card className="rounded-lg border border-border p-4">
			<Skeleton className="h-5 w-32" />
			<Skeleton className="mt-4 h-24 w-full" />
		</Card>
	);
}

function countDepartureAdjustments(payload: CampusTransportStatusResponse | null): number {
	if (!payload) {
		return 0;
	}
	return payload.groups.reduce(
		(total, group) =>
			total +
			group.routes.reduce(
				(routeTotal, route) =>
					routeTotal + route.departures.filter((departure) => departure.status !== "normal").length,
				0,
			),
		0,
	);
}

function collectSourceRefs(payload: CampusTransportStatusResponse | null): string[] {
	if (!payload) {
		return [];
	}
	const refs = [
		...payload.release.sourceRefs,
		...payload.groups.flatMap((group) =>
			group.routes.flatMap((route) =>
				route.departures.flatMap((departure) => departure.sourceRefs),
			),
		),
	];
	const seen = new Set<string>();
	return refs.filter((url) => {
		if (!/^https?:\/\//i.test(url) || seen.has(url)) {
			return false;
		}
		seen.add(url);
		return true;
	});
}

function formatDisplayDateTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) {
		return value;
	}
	return new Intl.DateTimeFormat("zh-CN", {
		day: "2-digit",
		hour: "2-digit",
		hour12: false,
		minute: "2-digit",
		month: "2-digit",
		timeZone: "Asia/Shanghai",
		year: "numeric",
	}).format(date);
}
