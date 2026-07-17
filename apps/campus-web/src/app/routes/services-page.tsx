import { LayoutGroup, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CampusMotionProvider, contentSwap, stateSwap } from "@/components/ui/motion";
import { SurfaceState } from "@/components/ui/surface-state";
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
		<section className="mx-auto max-w-[var(--layout-page-workspace-width)] px-4 py-6 pb-24 sm:px-5 lg:px-6">
			<h1 className="text-2xl font-semibold tracking-normal text-[var(--sys-text-strong)] md:text-3xl">
				班车时刻表
			</h1>

			<div className="mt-5 grid gap-6">
				<CampusMotionProvider>
					<TransportScheduleSection
						error={scheduleError}
						isLoading={isScheduleLoading}
						payload={schedulePayload}
					/>
				</CampusMotionProvider>
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
		<motion.section aria-labelledby="transport-schedule-heading" className="grid gap-4" layout>
			<div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
				<div>
					<h2
						className="text-xl font-semibold tracking-normal text-[var(--sys-text-strong)]"
						id="transport-schedule-heading"
					>
						班次安排
					</h2>
					{payload ? (
						<p className="mt-1 text-xs leading-5 text-[var(--sys-text-muted)]">
							更新于 {formatDisplayDateTime(payload.release.publishedAt)}
						</p>
					) : null}
				</div>
				{payload ? (
					<Badge className="h-9 px-3" variant={adjustmentCount > 0 ? "default" : "secondary"}>
						{adjustmentSummary}
					</Badge>
				) : null}
			</div>

			<LayoutGroup>
				<motion.div className="grid gap-5" layout>
					{error ? (
						<motion.div key="transport-error" layout {...stateSwap}>
							<SurfaceState
								description={error}
								kind="error"
								primaryAction={
									<Button onClick={() => window.location.reload()} type="button">
										重试
									</Button>
								}
								secondaryAction={
									<Button asChild variant="outline">
										<a href="/feedback?source=services">反馈</a>
									</Button>
								}
								title="班车数据不可用"
							/>
						</motion.div>
					) : null}
					{isLoading ? (
						<motion.div key="transport-loading" layout {...stateSwap}>
							<SurfaceState description="正在加载班车时刻。" kind="loading" title="正在加载" />
						</motion.div>
					) : null}
					{!(isLoading || error) && payload && payload.groups.length === 0 ? (
						<motion.div key="transport-empty" layout {...stateSwap}>
							<SurfaceState description="当前暂无可展示班次。" kind="empty" title="暂无班车时刻" />
						</motion.div>
					) : null}
					{!(isLoading || error) && payload && payload.groups.length > 0 ? (
						<motion.div className="grid gap-5" key="transport-groups" layout {...contentSwap}>
							{payload.groups.map((group) => (
								<TransportScheduleGroupSection group={group} key={group.kind} />
							))}
						</motion.div>
					) : null}
				</motion.div>
			</LayoutGroup>
			{sourceRefs.length > 0 ? (
				<motion.div className="grid gap-2 text-sm" layout {...stateSwap}>
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
				</motion.div>
			) : null}
		</motion.section>
	);
}

function TransportScheduleGroupSection({ group }: { group: CampusTransportStatusGroup }) {
	return (
		<motion.section
			aria-labelledby={`transport-group-${group.kind}`}
			className="grid gap-4"
			layout
			{...contentSwap}
		>
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
		</motion.section>
	);
}

function TransportRouteTable({ route }: { route: CampusTransportRoute }) {
	const rows = route.departures.map((departure, index) => ({
		...departure,
		rowId: `${route.routeId}:${index}:${departure.serviceDate ?? "baseline"}:${departure.departureTime}`,
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
				<div className="max-w-full overflow-x-auto rounded-[var(--card-radius)] border border-border bg-card shadow-[var(--card-shadow)]">
					<table
						aria-label={`${route.displayName}班车时刻表`}
						className="w-full min-w-[640px] border-collapse text-left"
					>
						<thead className="bg-surface-muted/70 text-xs text-[var(--sys-text-muted)]">
							<tr>
								{scheduleTableColumns.map((column) => (
									<th className="border-border border-b px-4 py-3 font-semibold" key={column.id}>
										{column.label}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map((departure) => (
								<TransportDepartureRow departure={departure} key={departure.rowId} />
							))}
						</tbody>
					</table>
				</div>
			) : (
				<Alert>当前路线暂无可展示班次。</Alert>
			)}
		</section>
	);
}

function TransportDepartureRow({ departure }: { departure: CampusTransportDeparture }) {
	return (
		<tr className="border-border border-b last:border-b-0">
			{scheduleTableColumns.map((column) => {
				const Cell = column.isRowHeader ? "th" : "td";
				return (
					<Cell
						className="px-4 py-3 align-middle font-normal"
						key={column.id}
						{...(column.isRowHeader ? { scope: "row" as const } : {})}
					>
						{renderDepartureCell(departure, column.id)}
					</Cell>
				);
			})}
		</tr>
	);
}

function renderDepartureCell(departure: CampusTransportDeparture, columnId: ScheduleTableColumnId) {
	if (columnId === "departureTime") {
		return (
			<div className="min-w-[96px]">
				{departure.serviceDate ? (
					<p className="mb-1 text-xs text-[var(--sys-text-muted)]">
						{formatServiceDate(departure.serviceDate)}
					</p>
				) : null}
				<p className="font-mono text-base font-semibold tabular-nums text-[var(--sys-text-strong)]">
					{departure.departureTime}
				</p>
			</div>
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
			{departure.note ?? "暂无"}
		</p>
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

function formatServiceDate(value: string): string {
	const date = new Date(`${value}T00:00:00+08:00`);
	if (Number.isNaN(date.valueOf())) {
		return value;
	}
	return new Intl.DateTimeFormat("zh-CN", {
		day: "numeric",
		month: "long",
		timeZone: "Asia/Shanghai",
		weekday: "short",
	}).format(date);
}
