import {
	type TransportPublicDeparture,
	type TransportPublicRoute,
	type TransportPublicScheduleResponse,
	transportRiderLabel,
	transportServiceKindLabel,
} from "@campus-agent/transport/domain";
import {
	Button,
	cn,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@campus-agent/ui";
import { ChevronLeft, ChevronRight, MapPin, RefreshCw } from "lucide-react";
import { CampusDatePicker } from "@/components/ui/date-picker";
import { StateMessage } from "@/components/ui/state-message";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type TransportDepartureStatus = "active" | "past" | "upcoming";
export type RiderFilter = "all" | "student" | "teacher";
export type RouteChoice = Pick<
	TransportPublicRoute,
	"routeId" | "origin" | "destination" | "serviceKind"
>;
export interface TransportPageViewProps {
	data?: TransportPublicScheduleResponse | undefined;
	date: string;
	routeId: string | undefined;
	routeChoices: readonly RouteChoice[];
	rider: RiderFilter;
	now: Date;
	onDateChange: (date: string) => void;
	onRouteChange: (id: string) => void;
	onRiderChange: (rider: RiderFilter) => void;
	onRefresh: () => void;
	refreshing?: boolean;
	loading?: boolean;
	failed?: boolean;
}
export function TransportPageView({
	data,
	date,
	routeId,
	routeChoices,
	rider,
	now,
	onDateChange,
	onRouteChange,
	onRiderChange,
	onRefresh,
	refreshing = false,
	loading = false,
	failed = false,
}: TransportPageViewProps) {
	const today = transportDate(now);
	const route = data?.routes.find((item) => item.routeId === routeId);
	const choices = routeChoices.filter(
		(choice) =>
			choice.routeId === routeId || data?.routes.some((item) => item.routeId === choice.routeId),
	);
	return (
		<section className="mx-auto w-full max-w-3xl px-4 py-5 pb-16 sm:px-6 sm:py-7">
			<header className="grid gap-4 border-b border-border pb-4">
				<h1 className="text-2xl font-semibold text-[var(--sys-text-strong)]">校园班车</h1>
				<div className="flex min-w-0 items-center gap-1">
					<Button
						aria-label="前一天"
						size="icon"
						variant="ghost"
						onClick={() => onDateChange(addDays(date, -1))}
					>
						<ChevronLeft />
					</Button>
					<CampusDatePicker value={date} ariaLabel={`选择日期：${date}`} onChange={onDateChange} />
					<Button
						aria-label="后一天"
						size="icon"
						variant="ghost"
						onClick={() => onDateChange(addDays(date, 1))}
					>
						<ChevronRight />
					</Button>
					<Button
						aria-label="刷新班车信息"
						size="icon"
						variant="ghost"
						disabled={refreshing}
						onClick={onRefresh}
					>
						<RefreshCw className={cn(refreshing && "animate-spin")} />
					</Button>
				</div>
				{date === today ? null : (
					<Button
						className="justify-self-start"
						variant="ghost"
						onClick={() => onDateChange(today)}
					>
						今天
					</Button>
				)}
				<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
					<div className="grid min-w-0 gap-1.5">
						<label htmlFor="transport-direction" className="text-sm text-[var(--sys-text-muted)]">
							线路方向
						</label>
						<Select
							value={routeId ?? ""}
							onValueChange={onRouteChange}
							disabled={choices.length === 0}
						>
							<SelectTrigger
								id="transport-direction"
								aria-label="线路方向"
								className="min-h-11 w-full min-w-0"
							>
								<SelectValue placeholder="选择线路方向" />
							</SelectTrigger>
							<SelectContent>
								{(["commute", "subway", "special"] as const).map((kind) => {
									const grouped = choices.filter((choice) => choice.serviceKind === kind);
									return grouped.length > 0 ? (
										<div key={kind}>
											<p className="px-2 py-1.5 text-xs text-[var(--sys-text-muted)]">
												{transportServiceKindLabel(kind)}
											</p>
											{grouped.map((choice) => (
												<SelectItem key={choice.routeId} value={choice.routeId}>
													{choice.origin} → {choice.destination}
												</SelectItem>
											))}
										</div>
									) : null;
								})}
							</SelectContent>
						</Select>
					</div>
					<ToggleGroup
						type="single"
						aria-label="班次对象"
						value={rider}
						onValueChange={(value) => {
							if (value === "all" || value === "student" || value === "teacher") {
								onRiderChange(value);
							}
						}}
						className="justify-start rounded-lg bg-surface-muted p-1"
					>
						{(["all", "student", "teacher"] as const).map((value) => (
							<ToggleGroupItem
								key={value}
								value={value}
								className="min-h-11 flex-1 rounded-md px-4 data-[state=on]:bg-selected data-[state=on]:text-selected-foreground"
							>
								{value === "all" ? "全部" : value === "student" ? "学生" : "教师"}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>
			</header>
			{failed ? (
				<StateMessage
					title={data ? "刷新失败，仍显示已有班次" : "班车信息加载失败"}
					layout="section"
					tone="danger"
					primaryAction={
						<Button variant="outline" onClick={onRefresh}>
							重试
						</Button>
					}
				/>
			) : null}
			{loading ? (
				<div
					role="status"
					aria-busy="true"
					aria-label="正在加载班车信息"
					className="mt-5 grid gap-3"
				>
					{[0, 1, 2, 3].map((row) => (
						<div key={row} className="h-16 rounded-md bg-surface-muted" />
					))}
				</div>
			) : data ? (
				route ? (
					<TransportRoute route={route} date={date} today={today} rider={rider} now={now} />
				) : (
					<StateMessage
						title={routeId ? "该方向当天暂无班次信息" : "当天暂无班次信息"}
						description="请选择其他日期或线路方向。"
					/>
				)
			) : null}
		</section>
	);
}

export function filterDepartures(
	departures: readonly TransportPublicDeparture[],
	rider: RiderFilter,
) {
	return departures
		.filter(
			(departure) =>
				rider === "all" || departure.riderType === rider || departure.riderType === "all",
		)
		.sort((a, b) => startTime(a).localeCompare(startTime(b)));
}
export function nextDepartures(
	departures: readonly TransportPublicDeparture[],
	date: string,
	now: Date,
) {
	if (date !== transportDate(now)) {
		return [];
	}
	const fixed = departures.filter(
		(item) => item.kind === "fixed" && getDepartureStatus(item, date, date, now) === "upcoming",
	);
	const first = fixed.reduce<string | undefined>(
		(earliest, item) => (!earliest || startTime(item) < earliest ? startTime(item) : earliest),
		undefined,
	);
	return departures.filter((item) =>
		item.kind === "interval"
			? getDepartureStatus(item, date, date, now) === "active"
			: item.departureTime === first,
	);
}
function TransportRoute({
	route,
	date,
	today,
	rider,
	now,
}: {
	route: TransportPublicRoute;
	date: string;
	today: string;
	rider: RiderFilter;
	now: Date;
}) {
	const departures = filterDepartures(route.departures, rider);
	const next = nextDepartures(departures, date, now);
	const isToday = date === today;
	return (
		<article aria-label={`${route.origin} → ${route.destination}`} className="mt-5">
			<h2 className="text-lg font-semibold">
				{route.origin} → {route.destination}
			</h2>
			{route.note ? (
				<p className="mt-1 text-sm text-[var(--sys-text-muted)]">{route.note}</p>
			) : null}
			{route.status === "suspended" ? (
				<StateMessage title="当天停运" />
			) : departures.length === 0 ? (
				<StateMessage title="当天暂无该对象班次" description="可切换班次对象查看。" />
			) : (
				<>
					{isToday && next.length > 0 ? (
						<section
							aria-label="下一班及当前运行班次"
							className="my-4 rounded-lg border border-info-border bg-info-subtle px-4 py-3"
						>
							{next.map((item, index) => (
								<div
									key={JSON.stringify(item)}
									className={cn(index > 0 && "mt-3 border-t border-info-border pt-3")}
								>
									<p className="text-sm text-info">
										{item.kind === "fixed" ? "下一班" : "正在运行"}
									</p>
									<p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
										<span className="font-mono text-3xl font-semibold tabular-nums">
											{departureTimeLabel(item)}
										</span>
										<span className="text-sm">{transportRiderLabel(item.riderType)}</span>
									</p>
									<BoardingPoint value={item.boardingPoint ?? route.boardingPoint} />
									{item.note ? <p className="mt-1 text-sm">{item.note}</p> : null}
								</div>
							))}
						</section>
					) : isToday &&
						departures.every((item) => getDepartureStatus(item, date, today, now) === "past") ? (
						<p className="my-4 text-sm text-[var(--sys-text-muted)]">今日班次已结束</p>
					) : null}
					{next.length === 0 && <BoardingPoint value={route.boardingPoint} />}
					<h3 className="mt-5 mb-2 text-sm font-medium text-[var(--sys-text-muted)]">完整时刻表</h3>
					<ul className="divide-y divide-border">
						{departures.map((item) => {
							const status = getDepartureStatus(item, date, today, now);
							const upcoming = isToday && next.includes(item);
							return (
								<li
									key={JSON.stringify(item)}
									className={cn(
										"py-3",
										isToday && status === "past" && "text-[var(--sys-text-muted)]",
									)}
								>
									<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
										<time
											dateTime={
												item.kind === "fixed" ? `${date}T${item.departureTime}:00+08:00` : undefined
											}
											className={cn(
												"font-mono text-xl font-semibold tabular-nums",
												upcoming && "text-info",
											)}
										>
											{departureTimeLabel(item)}
										</time>
										<div className="flex items-center gap-3 text-sm">
											<span>{transportRiderLabel(item.riderType)}</span>
											{isToday ? (
												<span className={cn("text-xs", upcoming && "text-info")}>
													{item.kind === "interval"
														? status === "active"
															? "正在运行"
															: status === "past"
																? "已结束"
																: "未开始"
														: upcoming
															? "下一班"
															: status === "past"
																? "已发车"
																: "未发车"}
												</span>
											) : null}
										</div>
									</div>
									{item.boardingPoint && item.boardingPoint !== route.boardingPoint ? (
										<BoardingPoint value={item.boardingPoint} />
									) : null}
									{item.note ? (
										<p className="mt-1 text-sm text-[var(--sys-text-muted)]">{item.note}</p>
									) : null}
									{item.capacity === null ? null : (
										<p className="mt-1 text-xs text-[var(--sys-text-muted)]">
											容量：{item.capacity} 人
										</p>
									)}
								</li>
							);
						})}
					</ul>
				</>
			)}
		</article>
	);
}
function BoardingPoint({ value }: { value: string | null }) {
	return value ? (
		<p className="mt-2 flex items-start gap-2 text-sm">
			<MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
			<span>乘车点：{value}</span>
		</p>
	) : null;
}
function departureTimeLabel(item: TransportPublicDeparture) {
	return item.kind === "fixed"
		? item.departureTime
		: `${item.firstDepartureTime}–${item.lastDepartureTime} · 每 ${item.intervalMinutes} 分钟`;
}
function startTime(item: TransportPublicDeparture) {
	return item.kind === "fixed" ? item.departureTime : item.firstDepartureTime;
}
export function getDepartureStatus(
	departure: TransportPublicDeparture,
	date: string,
	today: string,
	now: Date,
): TransportDepartureStatus {
	if (date < today) {
		return "past";
	}
	if (date > today) {
		return "upcoming";
	}
	const parts = new Intl.DateTimeFormat("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		timeZone: "Asia/Shanghai",
	}).format(now);
	if (departure.kind === "fixed") {
		return departure.departureTime <= parts ? "past" : "upcoming";
	}
	return parts < departure.firstDepartureTime
		? "upcoming"
		: parts <= departure.lastDepartureTime
			? "active"
			: "past";
}
export function transportDate(now: Date) {
	return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
}
function addDays(date: string, amount: number) {
	const parsed = new Date(`${date}T00:00:00Z`);
	parsed.setUTCDate(parsed.getUTCDate() + amount);
	return parsed.toISOString().slice(0, 10);
}
