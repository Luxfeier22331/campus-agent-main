import {
	formatWeekdays,
	type TransportPublicDeparture,
	type TransportPublicRoute,
	type TransportPublicScheduleResponse,
	type TransportRouteCatalogEntry,
	type TransportServiceKind,
	transportRiderLabel,
	transportServiceKindLabel,
} from "@campus-agent/transport/domain";
import { Button, cn, Disclosure, DisclosureSummary } from "@campus-agent/ui";
import { ChevronLeft, ChevronRight, MapPin, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { CampusDatePicker } from "@/components/ui/date-picker";
import { StateMessage } from "@/components/ui/state-message";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type TransportDepartureStatus = "active" | "past" | "upcoming";
export type RiderFilter = "all" | "student" | "teacher";
export type RouteChoice = TransportRouteCatalogEntry;
export interface TransportPageViewProps {
	data?: TransportPublicScheduleResponse | undefined;
	showRider?: boolean;
	date: string;
	routeId: string | undefined;
	routeChoices: readonly RouteChoice[];
	rider: RiderFilter;
	now: Date;
	serviceKind?: TransportServiceKind;
	serviceKinds?: readonly TransportServiceKind[];
	onDateChange: (date: string) => void;
	onRouteChange: (id: string) => void;
	onRiderChange: (rider: RiderFilter) => void;
	onServiceKindChange?: (kind: TransportServiceKind) => void;
	onRefresh: () => void;
	refreshing?: boolean;
	loading?: boolean;
	failed?: boolean;
	calendar?: (onSelect: (date: string) => void) => ReactNode;
}
export function TransportPageView({
	data,
	showRider: showRiderFromPrevious,
	date,
	routeId,
	routeChoices,
	rider,
	now,
	onDateChange,
	onRouteChange,
	onRiderChange,
	onRefresh,
	serviceKind,
	serviceKinds,
	onServiceKindChange,
	refreshing = false,
	loading = false,
	failed = false,
	calendar,
}: TransportPageViewProps) {
	const today = transportDate(now);
	const route = data?.routes.find((item) => item.routeId === routeId);
	const choice = routeChoices.find((item) => item.routeId === routeId);
	const kinds =
		serviceKinds ??
		(["commute", "subway", "special"] as const).filter((kind) =>
			routeChoices.some((item) => item.serviceKind === kind),
		);
	const activeKind = serviceKind ?? choice?.serviceKind ?? kinds[0] ?? "commute";
	const returnTo = `/transport?${new URLSearchParams({ date, rider, serviceKind: activeKind, routeId: routeId ?? "" })}`;
	const showRider =
		route?.departures.some((item) => item.riderType !== "all") ?? showRiderFromPrevious ?? false;
	const chooseKind = (value: string) => {
		if (onServiceKindChange) {
			onServiceKindChange(value as TransportServiceKind);
		} else {
			const first = routeChoices.find((item) => item.serviceKind === value);
			if (first) {
				onRouteChange(first.routeId);
			}
		}
	};
	return (
		<section className="campus-transport-page mx-auto w-full max-w-3xl px-4 py-4 pb-16 sm:px-6 sm:py-6">
			<header className="grid gap-3">
				<div className="flex items-center justify-between gap-3">
					<h1 className="text-2xl font-semibold">校园班车</h1>
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
				{kinds.length > 0 ? (
					<ToggleGroup
						type="single"
						aria-label="班车服务类型"
						value={activeKind}
						onValueChange={(value) => value && chooseKind(value)}
						presentation="segmented"
						className="grid auto-cols-fr grid-flow-col"
					>
						{kinds.map((kind) => (
							<ToggleGroupItem value={kind} key={kind} className="flex-1 px-2">
								{transportServiceKindLabel(kind)}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				) : null}
				<div className="flex min-w-0 items-center gap-1">
					<Button
						aria-label="前一天"
						size="icon"
						variant="ghost"
						onClick={() => onDateChange(addDays(date, -1))}
					>
						<ChevronLeft />
					</Button>
					<CampusDatePicker
						value={date}
						ariaLabel={`选择日期：${date}`}
						onChange={onDateChange}
						{...(calendar ? { calendar } : {})}
					/>
					<Button
						aria-label="后一天"
						size="icon"
						variant="ghost"
						onClick={() => onDateChange(addDays(date, 1))}
					>
						<ChevronRight />
					</Button>
					{date === today ? null : (
						<Button variant="ghost" className="shrink-0 px-2" onClick={() => onDateChange(today)}>
							今天
						</Button>
					)}
				</div>
				{activeKind === "subway" ? (
					<SubwayRoutePicker
						routes={routeChoices.filter((item) => item.serviceKind === "subway")}
						choice={choice}
						onChange={onRouteChange}
					/>
				) : (
					<ToggleGroup
						type="single"
						aria-label="线路方向"
						value={routeId ?? ""}
						onValueChange={(value) => value && onRouteChange(value)}
						presentation="segmented"
						className="grid grid-cols-2"
					>
						{routeChoices
							.filter((item) => item.serviceKind === activeKind)
							.map((item) => (
								<ToggleGroupItem
									key={item.routeId}
									value={item.routeId}
									className="whitespace-normal"
								>
									<span>
										<span className="whitespace-nowrap">{item.origin}</span> →{" "}
										<span className="whitespace-nowrap">{item.destination}</span>
									</span>
								</ToggleGroupItem>
							))}
					</ToggleGroup>
				)}
				{showRider ? (
					<div className="flex flex-wrap items-center justify-between gap-2">
						{showRider ? (
							<ToggleGroup
								type="single"
								aria-label="班次对象"
								value={rider}
								onValueChange={(value) => {
									if (value === "all" || value === "student" || value === "teacher") {
										onRiderChange(value);
									}
								}}
								presentation="segmented"
								className="justify-start"
							>
								{(["all", "student", "teacher"] as const).map((value) => (
									<ToggleGroupItem key={value} value={value} className="whitespace-nowrap">
										{value === "all" ? "全部" : value === "student" ? "学生" : "教师"}
									</ToggleGroupItem>
								))}
							</ToggleGroup>
						) : (
							<span className="text-xs text-muted-foreground">
								{(route?.departures?.length ?? 0) > 0 ? "全体师生" : ""}
							</span>
						)}
					</div>
				) : null}
			</header>
			{failed ? (
				<StateMessage
					title="班车信息加载失败"
					layout="section"
					tone="danger"
					primaryAction={
						<Button variant="outline" onClick={onRefresh}>
							重试
						</Button>
					}
				/>
			) : null}
			<div id="campus-transport-results">
				{loading ? (
					<div
						role="status"
						aria-busy="true"
						aria-label="正在加载班车信息"
						className="mt-4 grid gap-2"
					>
						{[0, 1, 2].map((i) => (
							<div key={i} className="h-14 rounded-md bg-surface-muted" />
						))}
					</div>
				) : data ? (
					choice ? (
						activeKind === "subway" ? (
							<SubwayStationRoutes
								returnTo={returnTo}
								choices={routeChoices.filter((item) => stationOf(item) === stationOf(choice))}
								routes={data?.routes ?? []}
								date={date}
								today={today}
								rider={showRider ? rider : "all"}
								now={now}
								onDateChange={onDateChange}
							/>
						) : (
							<TransportRoute
								returnTo={returnTo}
								key={`${date}:${routeId}`}
								route={route}
								choice={choice}
								date={date}
								today={today}
								rider={showRider ? rider : "all"}
								now={now}
								onDateChange={onDateChange}
							/>
						)
					) : (
						<StateMessage title="当天暂无班次信息" description="请选择其他日期或线路方向。" />
					)
				) : null}
			</div>
		</section>
	);
}

function stationOf(route: RouteChoice) {
	return route.origin === "丰台校区" ? route.destination : route.origin;
}

function SubwayStationRoutes({
	returnTo,
	choices,
	routes,
	date,
	today,
	rider,
	now,
	onDateChange,
}: {
	choices: readonly RouteChoice[];
	returnTo: string;
	routes: readonly TransportPublicRoute[];
	date: string;
	today: string;
	rider: RiderFilter;
	now: Date;
	onDateChange: (date: string) => void;
}) {
	const ordered = [...choices].sort(
		(a, b) => Number(b.origin === "丰台校区") - Number(a.origin === "丰台校区"),
	);
	return (
		<section
			aria-label={`${stationOf(ordered[0] as RouteChoice)}往返班次`}
			className="mt-3 grid gap-5"
		>
			{ordered.map((choice) => (
				<div key={choice.routeId} className="grid gap-2">
					<h2 className="text-base font-semibold">
						{choice.origin} → {choice.destination}
					</h2>
					<TransportRoute
						returnTo={returnTo}
						route={routes.find((item) => item.routeId === choice.routeId)}
						choice={choice}
						date={date}
						today={today}
						rider={rider}
						now={now}
						onDateChange={onDateChange}
					/>
				</div>
			))}
		</section>
	);
}

function SubwayRoutePicker({
	routes,
	choice,
	onChange,
}: {
	routes: readonly RouteChoice[];
	choice: RouteChoice | undefined;
	onChange: (routeId: string) => void;
}) {
	const stations = [...new Set(routes.map(stationOf))];
	const station = choice ? stationOf(choice) : stations[0];
	const outbound = choice?.origin === "丰台校区";
	return (
		<div className="grid gap-2">
			<ToggleGroup
				type="single"
				aria-label="地铁站"
				value={station ?? ""}
				presentation="segmented"
				className="grid grid-cols-2"
				onValueChange={(name) => {
					if (!name) {
						return;
					}
					const matches = routes.filter((route) => stationOf(route) === name);
					const next =
						matches.find((route) => (route.origin === "丰台校区") === outbound) ?? matches[0];
					if (next) {
						onChange(next.routeId);
					}
				}}
			>
				{stations.map((name) => (
					<ToggleGroupItem key={name} value={name} className="whitespace-nowrap">
						{name.replace(/地铁站$/u, "")}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
			<p className="text-sm text-muted-foreground">往返班次同时展示</p>
		</div>
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
	returnTo,
	route,
	choice,
	date,
	today,
	rider,
	now,
	onDateChange,
}: {
	route: TransportPublicRoute | undefined;
	returnTo: string;
	choice: RouteChoice;
	date: string;
	today: string;
	rider: RiderFilter;
	now: Date;
	onDateChange: (date: string) => void;
}) {
	const routeDepartures = route?.departures ?? [];
	const departures = filterDepartures(routeDepartures, rider);
	const next = nextDepartures(departures, date, now);
	const isToday = date === today;
	const points = new Set(
		routeDepartures.map(
			(item) => item.boardingPoint ?? route?.boardingPoint ?? choice.defaultBoardingPoint,
		),
	);
	const commonPoint = points.size === 1 ? ([...points][0] ?? null) : null;
	const pointByRider = new Map<TransportPublicDeparture["riderType"], string>();
	for (const riderType of ["all", "student", "teacher"] as const) {
		const riderPoints = new Set(
			routeDepartures
				.filter((item) => item.riderType === riderType)
				.map((item) => item.boardingPoint ?? route?.boardingPoint ?? choice.defaultBoardingPoint),
		);
		const point = [...riderPoints][0];
		if (riderPoints.size === 1 && point) {
			pointByRider.set(riderType, point);
		}
	}
	const allRiders = departures.length > 0 && departures.every((item) => item.riderType === "all");
	const past = isToday
		? departures.filter((item) => getDepartureStatus(item, date, today, now) === "past")
		: [];
	const remaining = isToday
		? departures.filter((item) => !(past.includes(item) || next.includes(item)))
		: departures;
	const canUseGrid =
		choice.serviceKind === "subway" &&
		departures.every(
			(item) =>
				item.kind === "fixed" &&
				!item.note &&
				item.capacity === null &&
				(item.boardingPoint ?? route?.boardingPoint ?? choice.defaultBoardingPoint) === commonPoint,
		);
	const renderList = (items: TransportPublicDeparture[]) => (
		<DepartureList
			items={items}
			date={date}
			today={today}
			now={now}
			commonPoint={commonPoint}
			pointByRider={pointByRider}
			defaultPoint={route?.boardingPoint ?? choice.defaultBoardingPoint}
			allRiders={allRiders}
			grid={canUseGrid}
		/>
	);
	return (
		<article aria-label={`${choice.origin} → ${choice.destination}`} className="mt-3">
			<h2 className="sr-only">
				{choice.origin} → {choice.destination}
			</h2>
			{!route || route.status === "suspended" ? (
				<>
					<StateMessage
						title={route ? "当天停运" : "当天暂无班次安排"}
						primaryAction={
							choice.nextServiceDate && choice.nextServiceDate > date ? (
								<Button
									variant="outline"
									onClick={() => onDateChange(choice.nextServiceDate as string)}
								>
									查看 {Number(choice.nextServiceDate.slice(5, 7))}月
									{Number(choice.nextServiceDate.slice(8))}日班次
								</Button>
							) : undefined
						}
					/>
					<Arrangement route={route} returnTo={returnTo} />
				</>
			) : departures.length > 0 ? (
				<>
					<RouteGuidance choice={choice} />
					{commonPoint ? (
						<BoardingPoint value={commonPoint} />
					) : pointByRider.size > 0 ? (
						<section aria-label="乘车点" className="mt-4 grid gap-1 text-sm">
							<p className="text-muted-foreground">乘车点</p>
							{[...pointByRider].map(([riderType, point]) => (
								<p key={riderType} className="flex gap-2">
									<span className="font-medium">{transportRiderLabel(riderType)}</span>
									<span className="text-muted-foreground">{point}</span>
								</p>
							))}
						</section>
					) : null}
					<Arrangement route={route} returnTo={returnTo} />
					{next.length > 0 ? (
						<section
							aria-label="下一班及当前运行班次"
							className="rounded-lg border border-info-border bg-info-subtle px-4 py-3"
						>
							{next.map((item, index) => (
								<div
									key={`${item.kind}-${departureTimeLabel(item)}-${item.riderType}`}
									className={cn(index > 0 && "mt-3 border-t border-info-border pt-3")}
								>
									<p className="text-sm text-info">
										{item.kind === "fixed" ? "下一班" : "正在运行"}
									</p>
									<p className="mt-1 flex flex-wrap items-baseline gap-x-3">
										<span className="font-mono text-3xl font-semibold tabular-nums">
											{departureTimeLabel(item)}
										</span>
										{allRiders ? null : (
											<span className="text-sm">{transportRiderLabel(item.riderType)}</span>
										)}
									</p>
									{commonPoint || pointByRider.has(item.riderType) ? null : (
										<BoardingPoint
											value={
												item.boardingPoint ?? route.boardingPoint ?? choice.defaultBoardingPoint
											}
										/>
									)}
									{item.note ? <p className="mt-1 text-sm">{item.note}</p> : null}
									{item.capacity ? <p className="mt-1 text-xs">容量：{item.capacity} 人</p> : null}
								</div>
							))}
						</section>
					) : isToday && past.length === departures.length ? (
						<p className="py-3 text-sm text-muted-foreground">今日班次已结束</p>
					) : null}
					{remaining.length > 0 ? (
						<section aria-label={isToday ? "后续班次" : "班次"} className="mt-4">
							{isToday ? <h3 className="mb-2 text-sm text-muted-foreground">后续班次</h3> : null}
							{timeGroups(remaining).length > 1
								? timeGroups(remaining).map((group) => (
										<section key={group.label} className="mb-3">
											<h4 className="mb-1 text-xs text-muted-foreground">{group.label}</h4>
											{renderList(group.items)}
										</section>
									))
								: renderList(remaining)}
						</section>
					) : null}
					{past.length > 0 ? (
						<Disclosure className="mt-3 text-muted-foreground">
							<DisclosureSummary className="text-sm">已发车 {past.length} 班</DisclosureSummary>
							<div className="pt-3">{renderList(past)}</div>
						</Disclosure>
					) : null}
				</>
			) : (
				<>
					<Arrangement route={route} returnTo={returnTo} />
					<StateMessage title="当天暂无该对象班次" description="可切换班次对象查看。" />
				</>
			)}
			{!route || route.status === "suspended" ? (
				<Disclosure className="mt-4 border-t pt-3 text-sm">
					<DisclosureSummary className="text-info">线路信息</DisclosureSummary>
					<BoardingPoint value={route?.boardingPoint ?? choice.defaultBoardingPoint} />
					<RouteGuidance choice={choice} expanded />
				</Disclosure>
			) : null}
		</article>
	);
}
function Arrangement({
	route,
	returnTo,
}: {
	route: TransportPublicRoute | undefined;
	returnTo: string;
}) {
	const context = route?.noticeContext;
	const hasNotices = context !== undefined && context.notices.length > 0;
	if (!(route && (route.note || hasNotices))) {
		return null;
	}
	const links = context?.notices.map((notice) => (
		<li key={notice.noticeId} className="min-w-0">
			<a
				className="inline-flex min-h-11 max-w-full items-center gap-2 py-2 text-info underline underline-offset-4"
				href={
					notice.isExternal
						? notice.externalUrl
						: `/notices/${notice.noticeId}?returnTo=${encodeURIComponent(returnTo)}`
				}
				{...(notice.isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
			>
				<span className="min-w-0 break-words">{notice.title}</span>
				<time className="shrink-0 text-xs text-muted-foreground" dateTime={notice.releasedAt}>
					{new Intl.DateTimeFormat("zh-CN", {
						timeZone: "Asia/Shanghai",
						year: "numeric",
						month: "numeric",
						day: "numeric",
					}).format(new Date(notice.releasedAt))}
				</time>
			</a>
		</li>
	));
	return (
		<section
			aria-label="班次安排"
			className="my-3 grid gap-1 border-l-2 border-info-border pl-3 text-sm"
		>
			{route.note ? <p className="whitespace-pre-line">{route.note}</p> : null}
			{hasNotices ? (
				<>
					<p className="text-xs text-muted-foreground">
						{context.validFrom}
						{context.validTo === context.validFrom
							? ""
							: context.validTo
								? ` — ${context.validTo}`
								: " 起"}{" "}
						·{" "}
						{context.weekdays.length === 7
							? "每天"
							: context.weekdays.join(",") === "1,2,3,4,5"
								? "周一至周五"
								: context.weekdays.join(",") === "6,7"
									? "周六、周日"
									: formatWeekdays(context.weekdays)}
					</p>
					{context.notices.length === 1 ? (
						<ul>{links}</ul>
					) : (
						<Disclosure>
							<DisclosureSummary>相关通知（{context.notices.length}）</DisclosureSummary>
							<ul>{links}</ul>
						</Disclosure>
					)}
				</>
			) : null}
		</section>
	);
}

function timeGroups(items: TransportPublicDeparture[]) {
	return [
		{ label: "早间", items: items.filter((item) => startTime(item) < "12:00") },
		{
			label: "白天",
			items: items.filter((item) => startTime(item) >= "12:00" && startTime(item) < "18:00"),
		},
		{ label: "晚间", items: items.filter((item) => startTime(item) >= "18:00") },
	].filter((group) => group.items.length > 0);
}
function DepartureList({
	items,
	date,
	today,
	now,
	commonPoint,
	pointByRider,
	defaultPoint,
	allRiders,
	grid,
}: {
	items: TransportPublicDeparture[];
	date: string;
	today: string;
	now: Date;
	commonPoint: string | null;
	pointByRider: ReadonlyMap<TransportPublicDeparture["riderType"], string>;
	defaultPoint: string | null;
	allRiders: boolean;
	grid: boolean;
}) {
	return (
		<ul className={grid ? "grid grid-cols-3 gap-2 sm:grid-cols-4" : "divide-y divide-border"}>
			{items.map((item) => {
				const status = getDepartureStatus(item, date, today, now);
				const point = item.boardingPoint ?? defaultPoint;
				return (
					<li
						key={`${item.kind}-${departureTimeLabel(item)}-${item.riderType}-${item.boardingPoint ?? ""}`}
						className={cn(
							grid ? "rounded-md border px-2 py-2 text-center" : "py-2",
							date === today && status === "past" && "text-muted-foreground",
						)}
					>
						<div className={grid ? "" : "flex flex-wrap items-baseline justify-between gap-2"}>
							<time
								dateTime={
									item.kind === "fixed" ? `${date}T${item.departureTime}:00+08:00` : undefined
								}
								className={cn("font-mono font-semibold tabular-nums", grid ? "text-lg" : "text-xl")}
							>
								{departureTimeLabel(item)}
							</time>
							{allRiders ? null : (
								<span className="text-sm">{transportRiderLabel(item.riderType)}</span>
							)}
							{date === today && !grid ? (
								<span className="text-xs text-muted-foreground">
									{item.kind === "interval"
										? status === "active"
											? "正在运行"
											: status === "past"
												? "已结束"
												: "未开始"
										: status === "past"
											? "已发车"
											: "未发车"}
								</span>
							) : null}
						</div>
						{point && point !== commonPoint && point !== pointByRider.get(item.riderType) ? (
							<BoardingPoint value={point} />
						) : null}
						{item.note ? <p className="mt-1 text-sm text-muted-foreground">{item.note}</p> : null}
						{item.capacity === null ? null : (
							<p className="mt-1 text-xs text-muted-foreground">容量：{item.capacity} 人</p>
						)}
					</li>
				);
			})}
		</ul>
	);
}
function RouteGuidance({ choice, expanded = false }: { choice: RouteChoice; expanded?: boolean }) {
	return choice.dropOffPoint || choice.boardingGuide ? (
		<aside className="mt-4 border-t pt-3 text-sm">
			{choice.dropOffPoint ? (
				<p className="text-muted-foreground">下车点：{choice.dropOffPoint}</p>
			) : null}
			{choice.boardingGuide ? (
				expanded ? (
					<p className="mt-2 whitespace-pre-line leading-relaxed">{choice.boardingGuide}</p>
				) : (
					<Disclosure className="mt-1">
						<DisclosureSummary className="text-info">乘车指引</DisclosureSummary>
						<p className="mt-3 whitespace-pre-line rounded-[var(--radius-lg)] bg-surface-muted p-3 leading-relaxed">
							{choice.boardingGuide}
						</p>
					</Disclosure>
				)
			) : null}
		</aside>
	) : null;
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
