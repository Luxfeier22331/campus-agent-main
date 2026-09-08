import {
	type TransportPublicDeparture,
	type TransportPublicRoute,
	type TransportPublicScheduleResponse,
	type TransportRouteCatalogEntry,
	type TransportServiceKind,
	transportRiderLabel,
	transportServiceKindLabel,
} from "@campus-agent/transport/domain";
import { Button, cn, Tabs, TabsList, TabsTrigger } from "@campus-agent/ui";
import { ArrowLeftRight, ChevronLeft, ChevronRight, MapPin, RefreshCw } from "lucide-react";
import { CampusDatePicker } from "@/components/ui/date-picker";
import { StateMessage } from "@/components/ui/state-message";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type TransportDepartureStatus = "active" | "past" | "upcoming";
export type RiderFilter = "all" | "student" | "teacher";
export type RouteChoice = TransportRouteCatalogEntry;
export interface TransportPageViewProps {
	data?: TransportPublicScheduleResponse | undefined;
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
	updating?: boolean;
	slowUpdating?: boolean;
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
	serviceKind,
	serviceKinds,
	onServiceKindChange,
	refreshing = false,
	loading = false,
	failed = false,
	updating = false,
	slowUpdating = false,
}: TransportPageViewProps) {
	const today = transportDate(now);
	const displayedDate = data?.date ?? date;
	const route = data?.routes.find((item) => item.routeId === routeId);
	const choice = routeChoices.find((item) => item.routeId === routeId);
	const kinds =
		serviceKinds ??
		(["commute", "subway", "special"] as const).filter((kind) =>
			routeChoices.some((item) => item.serviceKind === kind),
		);
	const activeKind = serviceKind ?? choice?.serviceKind ?? kinds[0] ?? "commute";
	const reverse = routeChoices.filter(
		(item) =>
			item.routeId !== routeId &&
			item.serviceKind === choice?.serviceKind &&
			item.origin === choice?.destination &&
			item.destination === choice?.origin,
	);
	const returnRoute = activeKind !== "subway" && reverse.length === 1 ? reverse[0] : undefined;
	const showRider = route?.departures.some((item) => item.riderType !== "all") ?? false;
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
		<section className="mx-auto w-full max-w-3xl px-4 py-4 pb-16 sm:px-6 sm:py-6">
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
					<Tabs value={activeKind} onValueChange={chooseKind}>
						<TabsList aria-label="班车服务类型">
							{kinds.map((kind) => (
								<TabsTrigger value={kind} key={kind} className="flex-1 px-2">
									{transportServiceKindLabel(kind)}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
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
					<CampusDatePicker value={date} ariaLabel={`选择日期：${date}`} onChange={onDateChange} />
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
				{updating && !failed ? (
					<p role="status" aria-live="polite" className="-mt-2 text-xs text-info">
						{slowUpdating ? "仍在更新" : "更新中"}
						{displayedDate === date ? "…" : ` · 当前为 ${shortDate(displayedDate)}班次`}
					</p>
				) : null}
				{activeKind === "subway" ? (
					<SubwayRoutePicker
						routes={routeChoices.filter((item) => item.serviceKind === "subway")}
						choice={choice}
						onChange={onRouteChange}
					/>
				) : (
					<fieldset>
						<legend className="sr-only">线路方向</legend>
						<div className="grid grid-cols-2 gap-2">
							{routeChoices
								.filter((item) => item.serviceKind === activeKind)
								.map((item) => (
									<Button
										key={item.routeId}
										variant="outline"
										aria-pressed={item.routeId === routeId}
										onClick={() => onRouteChange(item.routeId)}
										className={cn(
											"h-auto min-h-11 whitespace-normal px-2 py-2 text-sm",
											item.routeId === routeId &&
												"border-border-selected bg-selected text-selected-foreground",
										)}
									>
										{item.origin} → {item.destination}
									</Button>
								))}
						</div>
					</fieldset>
				)}
				{showRider || returnRoute ? (
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
								className="justify-start rounded-md bg-surface-muted p-1"
							>
								{(["all", "student", "teacher"] as const).map((value) => (
									<ToggleGroupItem
										key={value}
										value={value}
										className="min-h-11 rounded-md px-3 data-[state=on]:bg-selected data-[state=on]:text-selected-foreground"
									>
										{value === "all" ? "全部" : value === "student" ? "学生" : "教师"}
									</ToggleGroupItem>
								))}
							</ToggleGroup>
						) : (
							<span className="text-xs text-muted-foreground">
								{(route?.departures?.length ?? 0) > 0 ? "全体师生" : ""}
							</span>
						)}
						{returnRoute ? (
							<Button
								variant="ghost"
								className="ml-auto px-2"
								onClick={() => onRouteChange(returnRoute.routeId)}
							>
								<ArrowLeftRight />
								查返程
							</Button>
						) : null}
					</div>
				) : null}
			</header>
			{failed ? (
				<StateMessage
					title={data ? `查询失败，当前显示 ${shortDate(displayedDate)}班次` : "班车信息加载失败"}
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
					className="mt-4 grid gap-2"
				>
					{[0, 1, 2].map((i) => (
						<div key={i} className="h-14 rounded-md bg-surface-muted" />
					))}
				</div>
			) : data ? (
				choice ? (
					<TransportRoute
						key={`${displayedDate}:${routeId}:${rider}`}
						route={route}
						choice={choice}
						date={displayedDate}
						today={today}
						rider={showRider ? rider : "all"}
						now={now}
						onDateChange={onDateChange}
					/>
				) : (
					<StateMessage title="当天暂无班次信息" description="请选择其他日期或线路方向。" />
				)
			) : null}
		</section>
	);
}

function shortDate(date: string) {
	return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
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
	const stationOf = (route: RouteChoice) =>
		route.origin === "丰台校区" ? route.destination : route.origin;
	const stations = [...new Set(routes.map(stationOf))];
	const station = choice ? stationOf(choice) : stations[0];
	const outbound = choice?.origin === "丰台校区";
	const directions = routes.filter((route) => stationOf(route) === station);
	const buttonClass = (selected: boolean) =>
		cn(
			"h-auto min-h-11 whitespace-normal px-2 py-2 text-sm",
			selected && "border-border-selected bg-selected text-selected-foreground",
		);
	return (
		<div className="grid gap-2">
			<fieldset>
				<legend className="sr-only">地铁站</legend>
				<div className="grid grid-cols-2 gap-2">
					{stations.map((name) => (
						<Button
							key={name}
							variant="outline"
							aria-pressed={name === station}
							className={buttonClass(name === station)}
							onClick={() => {
								const matches = routes.filter((route) => stationOf(route) === name);
								const next =
									matches.find((route) => (route.origin === "丰台校区") === outbound) ?? matches[0];
								if (next) {
									onChange(next.routeId);
								}
							}}
						>
							{name.replace(/地铁站$/u, "")}
						</Button>
					))}
				</div>
			</fieldset>
			<fieldset>
				<legend className="sr-only">线路方向</legend>
				<div className="grid grid-cols-2 gap-2">
					{[...directions]
						.sort((a, b) => Number(b.origin === "丰台校区") - Number(a.origin === "丰台校区"))
						.map((route) => (
							<Button
								key={route.routeId}
								variant="outline"
								aria-pressed={route.routeId === choice?.routeId}
								className={buttonClass(route.routeId === choice?.routeId)}
								onClick={() => onChange(route.routeId)}
							>
								{route.origin === "丰台校区" ? "去地铁站" : "回丰台校区"}
							</Button>
						))}
				</div>
			</fieldset>
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
	route,
	choice,
	date,
	today,
	rider,
	now,
	onDateChange,
}: {
	route: TransportPublicRoute | undefined;
	choice: RouteChoice;
	date: string;
	today: string;
	rider: RiderFilter;
	now: Date;
	onDateChange: (date: string) => void;
}) {
	const departures = filterDepartures(route?.departures ?? [], rider);
	const next = nextDepartures(departures, date, now);
	const isToday = date === today;
	const points = new Set(
		departures.map(
			(item) => item.boardingPoint ?? route?.boardingPoint ?? choice.defaultBoardingPoint,
		),
	);
	const commonPoint = points.size === 1 ? ([...points][0] ?? null) : null;
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
					{route?.note ? <p className="text-sm">{route.note}</p> : null}
				</>
			) : departures.length > 0 ? (
				<>
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
									<BoardingPoint
										value={item.boardingPoint ?? route.boardingPoint ?? choice.defaultBoardingPoint}
									/>
									{item.note ? <p className="mt-1 text-sm">{item.note}</p> : null}
									{item.capacity ? <p className="mt-1 text-xs">容量：{item.capacity} 人</p> : null}
								</div>
							))}
						</section>
					) : isToday && past.length === departures.length ? (
						<p className="py-3 text-sm text-muted-foreground">今日班次已结束</p>
					) : null}
					{commonPoint &&
					!next.some(
						(item) =>
							(item.boardingPoint ?? route.boardingPoint ?? choice.defaultBoardingPoint) ===
							commonPoint,
					) ? (
						<BoardingPoint value={commonPoint} />
					) : null}
					{remaining.length > 0 ? (
						<section aria-label={isToday ? "后续班次" : "完整时刻表"} className="mt-4">
							<h3 className="mb-2 text-sm text-muted-foreground">
								{isToday ? "后续班次" : "完整时刻表"}
							</h3>
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
						<details className="mt-3 text-muted-foreground">
							<summary className="min-h-11 cursor-pointer content-center text-sm">
								已发车 {past.length} 班
							</summary>
							{renderList(past)}
						</details>
					) : null}
					{route.note ? <p className="mt-3 text-sm text-muted-foreground">{route.note}</p> : null}
				</>
			) : (
				<StateMessage title="当天暂无该对象班次" description="可切换班次对象查看。" />
			)}
			{!route || route.status === "suspended" ? (
				<details className="mt-4 border-t pt-3 text-sm">
					<summary className="min-h-11 cursor-pointer content-center text-info">线路信息</summary>
					<BoardingPoint value={route?.boardingPoint ?? choice.defaultBoardingPoint} />
					<RouteGuidance choice={choice} expanded />
				</details>
			) : (
				<RouteGuidance choice={choice} />
			)}
		</article>
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
	defaultPoint,
	allRiders,
	grid,
}: {
	items: TransportPublicDeparture[];
	date: string;
	today: string;
	now: Date;
	commonPoint: string | null;
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
						{point && point !== commonPoint ? <BoardingPoint value={point} /> : null}
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
					<details className="mt-1">
						<summary className="min-h-11 cursor-pointer content-center text-info">乘车指引</summary>
						<p className="whitespace-pre-line rounded-md bg-surface-muted p-3 leading-relaxed">
							{choice.boardingGuide}
						</p>
					</details>
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
