import { Table } from "@heroui/react";
import { CalendarDays } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getCampusTransportSchedule } from "@/features/campus-services/api";
import type {
	CampusTransportDeparture,
	CampusTransportDepartureStatus,
	CampusTransportRoute,
	CampusTransportScheduleResponse,
} from "@/features/campus-services/model";

const departureStatusLabels: Record<CampusTransportDepartureStatus, string> = {
	added: "加开",
	cancelled: "取消",
	changed: "调整",
	delayed: "延迟",
	normal: "正常",
};

const routeStatusLabels: Record<CampusTransportRoute["status"], string> = {
	limited_service: "部分运行",
	not_running: "停运",
	running: "运行中",
	temporarily_suspended: "临时停运",
	unknown: "待确认",
};

const serviceDayKindLabels: Record<CampusTransportScheduleResponse["serviceDayKind"], string> = {
	holiday: "节假日",
	temporary: "临时安排",
	unknown: "以发布时刻表为准",
	weekend: "周末",
	workday: "工作日",
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
	const [serviceDate, setServiceDate] = useState(() => formatLocalDate(new Date()));
	const [schedulePayload, setSchedulePayload] = useState<CampusTransportScheduleResponse | null>(
		null,
	);
	const [isScheduleLoading, setIsScheduleLoading] = useState(true);
	const [scheduleError, setScheduleError] = useState<string | null>(null);

	useEffect(() => {
		let isMounted = true;
		setIsScheduleLoading(true);
		getCampusTransportSchedule({ serviceDate })
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
	}, [serviceDate]);

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
					onServiceDateChange={setServiceDate}
					payload={schedulePayload}
					serviceDate={serviceDate}
				/>
			</div>
		</section>
	);
}

function TransportScheduleSection({
	error,
	isLoading,
	onServiceDateChange,
	payload,
	serviceDate,
}: {
	error: string | null;
	isLoading: boolean;
	onServiceDateChange: (serviceDate: string) => void;
	payload: CampusTransportScheduleResponse | null;
	serviceDate: string;
}) {
	const adjustmentSummary = payload?.hasAdjustments
		? `今日含 ${payload.adjustmentCount} 条调整`
		: "今日暂无调整";
	const notices = useMemo(() => dedupeSourceNotices(payload?.notices ?? []), [payload]);
	return (
		<section aria-labelledby="transport-schedule-heading" className="grid gap-4">
			<div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
				<div>
					<div className="flex items-center gap-2 text-sm text-[var(--sys-text-muted)]">
						<CalendarDays aria-hidden="true" className="size-4" />
						<span>{serviceDayLabel(payload)}</span>
					</div>
					<h2
						className="mt-1 text-xl font-semibold tracking-normal text-[var(--sys-text-strong)]"
						id="transport-schedule-heading"
					>
						班车时刻表
					</h2>
					{payload?.release ? (
						<p className="mt-1 text-xs leading-5 text-[var(--sys-text-muted)]">
							发布于 {formatDisplayDateTime(payload.release.publishedAt)} ·{" "}
							{payload.release.releaseId}
						</p>
					) : null}
				</div>
				<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
					<div className="grid gap-1.5">
						<Label htmlFor="transport-schedule-date">服务日期</Label>
						<Input
							className="w-[180px]"
							id="transport-schedule-date"
							onChange={(event) => {
								if (event.target.value) {
									onServiceDateChange(event.target.value);
								}
							}}
							type="date"
							value={serviceDate}
						/>
					</div>
					<Badge className="h-9 px-3" variant={payload?.hasAdjustments ? "default" : "secondary"}>
						{adjustmentSummary}
					</Badge>
				</div>
			</div>

			{error ? <Alert variant="destructive">{error}</Alert> : null}
			{isLoading ? <TransportScheduleSkeleton /> : null}
			{!(isLoading || error) && payload?.status === "unavailable" ? (
				<Alert>班车时刻表暂时无法读取。</Alert>
			) : null}
			{!(isLoading || error) && payload?.status === "available" && payload.routes.length === 0 ? (
				<Alert>当前日期暂无可展示班次。</Alert>
			) : null}
			{!(isLoading || error) && payload?.status === "available" && payload.routes.length > 0 ? (
				<div className="grid gap-5">
					{payload.routes.map((route) => (
						<TransportRouteTable key={route.routeId} route={route} />
					))}
				</div>
			) : null}
			{notices.length > 0 ? (
				<div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
					{notices.map((notice) => (
						<a
							className="font-medium text-[var(--sys-text-link)] underline-offset-4 hover:underline"
							href={notice.url}
							key={notice.url}
							rel="noreferrer"
							target="_blank"
						>
							{notice.title || "班车时刻表来源"}
						</a>
					))}
				</div>
			) : null}
		</section>
	);
}

function TransportRouteTable({ route }: { route: CampusTransportRoute }) {
	return (
		<section aria-labelledby={`transport-route-${route.routeId}`} className="grid gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<h3
					className="text-base font-semibold tracking-normal text-[var(--sys-text-strong)]"
					id={`transport-route-${route.routeId}`}
				>
					{route.displayName}
				</h3>
				<Badge variant={route.status === "running" ? "secondary" : "outline"}>
					{routeStatusLabels[route.status]}
				</Badge>
			</div>
			{route.note ? (
				<p className="max-w-3xl text-sm leading-6 text-[var(--sys-text-muted)]">{route.note}</p>
			) : null}
			{route.departures.length > 0 ? (
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
							<Table.Body items={route.departures}>
								{(departure) => (
									<TransportDepartureRow departure={departure} routeId={route.routeId} />
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
	routeId,
}: {
	departure: CampusTransportDeparture;
	routeId: string;
}) {
	return (
		<Table.Row columns={scheduleTableColumns} id={`${routeId}:${departure.id}`}>
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
		return <p className="min-w-[88px] text-sm text-[var(--sys-text-muted)]">{departure.type}</p>;
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
		return departure.type;
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

function dedupeSourceNotices(notices: CampusTransportScheduleResponse["notices"]) {
	const seen = new Set<string>();
	return notices.filter((notice) => {
		if (!notice.url || seen.has(notice.url)) {
			return false;
		}
		seen.add(notice.url);
		return true;
	});
}

function serviceDayLabel(payload: CampusTransportScheduleResponse | null): string {
	if (!payload) {
		return "以发布时刻表为准";
	}
	const dayKindLabel = serviceDayKindLabels[payload.serviceDayKind];
	if (payload.serviceDayKind === "unknown") {
		return payload.calendarLabel || dayKindLabel;
	}
	return dayKindLabel;
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

function formatLocalDate(value: Date): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		day: "2-digit",
		month: "2-digit",
		timeZone: "Asia/Shanghai",
		year: "numeric",
	}).formatToParts(value);
	const readPart = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
	return `${readPart("year")}-${readPart("month")}-${readPart("day")}`;
}
