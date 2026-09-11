import {
	formatWeekdays,
	selectTransportPeriod,
	shiftTransportDate,
	transportPeriodIncludesDate,
} from "@campus-agent/transport/domain";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogTitle,
	Badge,
	Button,
	cn,
	Disclosure,
	DisclosureSummary,
	NativeSelect,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
	TransportOpsRoute,
	TransportOpsSchedulePeriod,
	TransportOpsSchedulePeriodInput,
} from "../server/transport-store-contract";
import { TransportOpsSchedulePeriodInputSchema } from "../server/transport-store-contract";
import {
	deleteTransportRoute,
	deleteTransportSchedulePeriod,
	fetchTransportRoutes,
	fetchTransportSchedulePeriods,
} from "./ops-api-client";
import { ErrorState, InlineError, PageHeader, PageShell } from "./ops-display";
import { TransportCalendar } from "./transport-calendar";
import { TransportPeriodEditor, TransportRouteEditor } from "./transport-editors";

import { effectiveDetails } from "./transport-impact";
import { ConfirmAction } from "./ui/alert-dialog";

function weekdayOf(date: string) {
	const day = new Date(`${date}T00:00:00Z`).getUTCDay();
	return day === 0 ? 7 : day;
}

const QUERY_ROOT = ["transport", "ops"] as const;
const KINDS = ["commute", "subway", "special"] as const;
type ServiceKind = (typeof KINDS)[number];
type Editor =
	| { type: "route"; source: TransportOpsRoute | null }
	| {
			type: "period";
			source: TransportOpsSchedulePeriod | null;
			copy: boolean;
			initial?: TransportOpsSchedulePeriodInput;
	  };

export function TransportPage() {
	const client = useQueryClient();
	const routes = useQuery({
		queryKey: [...QUERY_ROOT, "routes"],
		queryFn: ({ signal }) => fetchTransportRoutes({ signal }),
	});
	const periods = useQuery({
		queryKey: [...QUERY_ROOT, "schedule-periods"],
		queryFn: ({ signal }) => fetchTransportSchedulePeriods({ signal }),
	});
	const refresh = () => void client.invalidateQueries({ queryKey: QUERY_ROOT });
	const error = routes.error ?? periods.error;
	if (!(routes.data && periods.data)) {
		return error ? (
			<ErrorState error={error} onRetry={refresh} title="班车数据读取失败" />
		) : (
			<PageShell title="班车维护">正在读取班车数据…</PageShell>
		);
	}
	return (
		<TransportWorkspace
			routes={routes.data.routes}
			periods={periods.data.schedulePeriods}
			onChanged={refresh}
			refreshing={routes.isFetching || periods.isFetching}
			error={error}
		/>
	);
}

function TransportWorkspace({
	routes,
	periods,
	onChanged,
	refreshing,
	error,
}: {
	routes: TransportOpsRoute[];
	periods: TransportOpsSchedulePeriod[];
	onChanged: () => void;
	refreshing: boolean;
	error: unknown;
}) {
	const kinds = KINDS.filter((kind) => routes.some((route) => route.serviceKind === kind));
	const [requestedKind, setKind] = useState<ServiceKind>(kinds[0] ?? "commute");
	const kind = kinds.includes(requestedKind) ? requestedKind : (kinds[0] ?? "commute");
	const kindRoutes = routes.filter((route) => route.serviceKind === kind);
	const [selectedId, setSelectedId] = useState<string>();
	const selected = kindRoutes.find((route) => route.routeId === selectedId) ?? kindRoutes[0];
	const routePeriods = periods.filter((period) => period.routeId === selected?.routeId);
	const [editor, setEditor] = useState<Editor | null>(null);
	const [dirty, setDirty] = useState(false);
	const [busy, setBusy] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const pendingAction = useRef<(() => void) | null>(null);
	const editorRef = useRef<HTMLDivElement>(null);
	const close = () => {
		setEditor(null);
		setDirty(false);
		setBusy(false);
	};
	const guard = (action: () => void) => {
		if (busy) {
			return;
		}
		if (dirty) {
			pendingAction.current = action;
			setConfirmOpen(true);
		} else {
			action();
		}
	};
	useEffect(() => {
		if (editor) {
			editorRef.current?.scrollIntoView({ block: "start" });
			editorRef.current?.focus({ preventScroll: true });
		}
	}, [editor]);
	useEffect(() => {
		if (!dirty) {
			return;
		}
		const beforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, [dirty]);
	const begin = (next: Editor) =>
		guard(() => {
			setDirty(false);
			setEditor(next);
		});
	const selectRoute = (id: string) =>
		guard(() => {
			close();
			setSelectedId(id);
		});
	const selectKind = (value: string) =>
		guard(() => {
			close();
			setKind(value as ServiceKind);
			setSelectedId(undefined);
		});
	const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
	const [viewDate, setViewDate] = useState(today);
	const [calendarMonth, setCalendarMonth] = useState(`${today.slice(0, 7)}-01`);
	const effective = selectTransportPeriod(routePeriods, viewDate);
	return (
		<section className="mx-auto w-full max-w-[1440px]">
			<PageHeader
				title="班车维护"
				actions={
					<div className="flex gap-2">
						<Button
							aria-label="刷新班车数据"
							disabled={refreshing || busy}
							size="icon"
							variant="outline"
							onClick={() =>
								guard(() => {
									close();
									onChanged();
								})
							}
						>
							<RefreshCw className={cn(refreshing && "animate-spin")} />
						</Button>
						<Button onClick={() => begin({ type: "route", source: null })}>
							<Plus />
							新增线路
						</Button>
					</div>
				}
			/>
			{error ? <InlineError error={error} title="刷新失败，仍显示已有班车数据" /> : null}
			<Tabs value={kind} onValueChange={selectKind}>
				<TabsList aria-label="班车服务类型" presentation="segmented">
					{kinds.map((item) => (
						<TabsTrigger key={item} value={item}>
							{kindLabel(item)}
						</TabsTrigger>
					))}
				</TabsList>
				<TabsContent value={kind} className="mt-4">
					<div className="grid items-start gap-5 xl:grid-cols-[15rem_minmax(0,1fr)]">
						<div className="min-w-0">
							<label className="grid gap-1 text-sm xl:hidden" htmlFor="ops-transport-route">
								线路方向
							</label>
							<NativeSelect
								id="ops-transport-route"
								className="xl:hidden"
								value={selected?.routeId ?? ""}
								onChange={(event) => selectRoute(event.target.value)}
							>
								{kindRoutes.map((route) => (
									<option key={route.routeId} value={route.routeId}>
										{route.origin} → {route.destination}
									</option>
								))}
							</NativeSelect>
							<nav aria-label="班车线路" className="hidden gap-2 xl:grid">
								{kindRoutes.map((route) => {
									const entries = periods.filter((period) => period.routeId === route.routeId);
									const active = entries.filter(
										(period) => !period.validTo || period.validTo >= today,
									);
									const preview = active
										.find((period) => period.status === "operating")
										?.items.slice(0, 3)
										.map(itemTime)
										.join(" · ");
									return (
										<button
											type="button"
											key={route.routeId}
											aria-current={selected?.routeId === route.routeId ? "true" : undefined}
											onClick={() => selectRoute(route.routeId)}
											className={cn(
												"grid gap-1.5 rounded-md border p-3 text-left text-sm",
												selected?.routeId === route.routeId
													? "border-border-selected bg-selected text-selected-foreground"
													: "border-transparent hover:bg-surface-muted",
											)}
										>
											<span className="font-medium">
												{route.origin} → {route.destination}
											</span>
											<span className="text-xs text-muted-foreground">
												{active.length} 个当前/后续安排
											</span>
											{preview ? (
												<span className="font-mono text-xs text-muted-foreground">{preview}</span>
											) : null}
										</button>
									);
								})}
							</nav>
						</div>
						<div className="min-w-0 scroll-mt-24 outline-none" ref={editorRef} tabIndex={-1}>
							{editor?.type === "route" ? (
								<TransportRouteEditor
									key={editor.source?.routeId ?? "new"}
									source={editor.source}
									kind={kind}
									onDirty={setDirty}
									onBusy={setBusy}
									onCancel={() => guard(close)}
									onSaved={(route) => {
										close();
										setKind(route.serviceKind);
										setSelectedId(route.routeId);
										onChanged();
									}}
								/>
							) : editor?.type === "period" && selected ? (
								<TransportPeriodEditor
									key={`${editor.copy ? "copy" : "edit"}-${editor.source?.scheduleId ?? "new"}`}
									source={editor.source}
									copy={editor.copy}
									route={selected}
									periods={routePeriods}
									effectiveDate={viewDate}
									{...(editor.initial ? { initial: editor.initial } : {})}
									onDirty={setDirty}
									onBusy={setBusy}
									onCancel={() => guard(close)}
									onSaved={(period) => {
										if (editor.copy || !editor.source) {
											setViewDate(period.validFrom);
											setCalendarMonth(`${period.validFrom.slice(0, 7)}-01`);
										}
										close();
										onChanged();
									}}
								/>
							) : selected ? (
								<div className="grid gap-5">
									<div className="grid items-start gap-4 lg:grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.1fr)]">
										<TransportCalendar
											key={selected.routeId}
											periods={routePeriods}
											date={viewDate}
											month={calendarMonth}
											onMonthChange={setCalendarMonth}
											onDateChange={setViewDate}
											onApplyPeriod={(source, from, to) =>
												begin({
													type: "period",
													source,
													copy: true,
													initial: periodInputForRange(source, from, to, source.status),
												})
											}
											onSuspendPeriod={(from, to) =>
												begin({
													type: "period",
													source: null,
													copy: false,
													initial: {
														routeId: selected.routeId,
														validFrom: from,
														validTo: to,
														weekdays: [1, 2, 3, 4, 5, 6, 7],
														status: "suspended",
														items: [],
														boardingPointOverride: null,
														note: null,
													},
												})
											}
										/>
										<section aria-label="当天有效班次" className="grid gap-3 rounded-lg border p-4">
											<div className="flex flex-wrap items-center justify-between gap-2">
												<h3 className="font-semibold">{viewDate} · 当天有效班次</h3>
												{effective ? (
													<Button
														variant="outline"
														onClick={() =>
															begin({ type: "period", source: effective, copy: false })
														}
													>
														编辑生效时间段
													</Button>
												) : (
													<Button
														onClick={() =>
															begin({
																type: "period",
																source: null,
																copy: false,
																initial: {
																	routeId: selected.routeId,
																	validFrom: viewDate,
																	validTo: viewDate,
																	weekdays: [weekdayOf(viewDate)],
																	status: "operating",
																	items: [],
																	boardingPointOverride: null,
																	note: null,
																},
															})
														}
													>
														新增时间段
													</Button>
												)}
											</div>
											{effective ? (
												<p className="text-xs text-muted-foreground">
													生效时间段：{periodLabel(effective)}
												</p>
											) : null}
											<p className="whitespace-pre-line text-sm leading-7">
												{effectiveDetails(effective, selected).join("\n")}
											</p>
										</section>
									</div>
									<RouteDetails
										route={selected}
										periods={routePeriods}
										today={today}
										onChanged={onChanged}
										onEditRoute={() => begin({ type: "route", source: selected })}
										onNew={() => begin({ type: "period", source: null, copy: false })}
										onEdit={(period) => begin({ type: "period", source: period, copy: false })}
										onCopy={(period) => begin({ type: "period", source: period, copy: true })}
										onEnd={(period) =>
											begin({
												type: "period",
												source: period,
												copy: false,
												initial: periodInputWithEnd(period, shiftTransportDate(today, -1)),
											})
										}
									/>
								</div>
							) : (
								<p className="py-8 text-muted-foreground">尚未配置线路，请新增线路。</p>
							)}
						</div>
					</div>
				</TabsContent>
			</Tabs>
			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
					<AlertDialogDescription>当前修改尚未保存。</AlertDialogDescription>
					<AlertDialogFooter>
						<AlertDialogCancel>继续编辑</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setDirty(false);
								const action = pendingAction.current;
								pendingAction.current = null;
								action?.();
							}}
						>
							放弃修改
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}

function RouteDetails({
	route,
	periods,
	today,
	onChanged,
	onEditRoute,
	onNew,
	onEdit,
	onCopy,
	onEnd,
}: {
	route: TransportOpsRoute;
	periods: TransportOpsSchedulePeriod[];
	today: string;
	onChanged: () => void;
	onEditRoute: () => void;
	onNew: () => void;
	onEdit: (period: TransportOpsSchedulePeriod) => void;
	onCopy: (period: TransportOpsSchedulePeriod) => void;
	onEnd: (period: TransportOpsSchedulePeriod) => void;
}) {
	const remove = useMutation({ mutationFn: deleteTransportRoute, onSuccess: onChanged });
	const groups = [
		{
			label: "当前适用",
			entries: periods.filter(
				(period) => period.validFrom <= today && (!period.validTo || period.validTo >= today),
			),
		},
		{ label: "后续安排", entries: periods.filter((period) => period.validFrom > today) },
		{
			label: "已结束",
			entries: periods.filter((period) => period.validTo && period.validTo < today),
		},
	];
	const hasItemPoints = periods.some(
		(period) => period.boardingPointOverride || period.items.some((item) => item.boardingPoint),
	);
	return (
		<div className="grid gap-5">
			<header className="grid gap-3 border-b pb-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 className="text-xl font-semibold">
						{route.origin} → {route.destination}
					</h2>
					<Button variant="outline" onClick={onEditRoute}>
						编辑线路
					</Button>
				</div>
				<dl className="grid gap-2 text-sm sm:grid-cols-2">
					<div>
						<dt className="text-xs text-muted-foreground">默认乘车点</dt>
						<dd>
							{route.defaultBoardingPoint ?? (hasItemPoints ? "按时间段或班次设置" : "未填写")}
						</dd>
					</div>
					{route.dropOffPoint ? (
						<div>
							<dt className="text-xs text-muted-foreground">下车点</dt>
							<dd>{route.dropOffPoint}</dd>
						</div>
					) : null}
				</dl>
				{route.boardingGuide ? (
					<Disclosure className="text-sm">
						<DisclosureSummary className="text-info">乘车指引</DisclosureSummary>
						<p className="whitespace-pre-line pt-3">{route.boardingGuide}</p>
					</Disclosure>
				) : null}
			</header>
			<div className="flex justify-between items-center gap-2">
				<h3 className="font-semibold">时间安排</h3>
				<Button onClick={onNew}>
					<Plus />
					新增时间段
				</Button>
			</div>
			{periods.length === 0 ? (
				<p className="text-muted-foreground text-sm">这条线路还没有时间安排。</p>
			) : null}
			{groups
				.filter((group) => group.entries.length)
				.map((group) => (
					<section key={group.label} className="grid gap-2" aria-label={group.label}>
						<h4 className="text-sm text-muted-foreground">{group.label}</h4>
						{[...group.entries]
							.sort((a, b) => b.validFrom.localeCompare(a.validFrom))
							.map((period) => (
								<PeriodCard
									key={period.scheduleId}
									period={period}
									route={route}
									today={today}
									onChanged={onChanged}
									onEdit={() => onEdit(period)}
									onCopy={() => onCopy(period)}
									onEnd={() => onEnd(period)}
									canEnd={!period.validTo || period.validTo >= today}
								/>
							))}
					</section>
				))}
			<div className="border-t pt-3">
				<ConfirmAction
					title="删除这条线路？"
					description="请先删除该线路关联的时间安排。"
					confirmLabel="删除线路"
					onConfirm={() => remove.mutate(route.routeId)}
					trigger={
						<Button variant="ghost" disabled={periods.length > 0 || remove.isPending}>
							删除线路
						</Button>
					}
				/>
				{remove.error ? <InlineError error={remove.error} title="线路删除失败" /> : null}
			</div>
		</div>
	);
}

function PeriodCard({
	period,
	route,
	today,
	onChanged,
	onEdit,
	onCopy,
	onEnd,
	canEnd,
}: {
	period: TransportOpsSchedulePeriod;
	route: TransportOpsRoute;
	today: string;
	onChanged: () => void;
	onEdit: () => void;
	onCopy: () => void;
	onEnd: () => void;
	canEnd: boolean;
}) {
	const remove = useMutation({ mutationFn: deleteTransportSchedulePeriod, onSuccess: onChanged });
	return (
		<section className="rounded-md border p-3 sm:p-4" aria-label={periodLabel(period)}>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="grid gap-1">
					<div className="flex flex-wrap gap-2 items-center">
						<h5 className="font-medium">{weekdayLabel(period.weekdays)}</h5>
						<Badge tone={period.status === "operating" ? "success" : "danger"}>
							{period.status === "operating" ? "运行" : "停运"}
						</Badge>
					</div>
					<p className="text-xs text-muted-foreground">
						{period.validFrom} 起{period.validTo ? `，至 ${period.validTo}` : "，长期"}
						{transportPeriodIncludesDate(period, today) ? " · 包含今天" : ""}
					</p>
				</div>
				<div className="flex gap-1">
					<Button
						onClick={onEdit}
						size="sm"
						variant="outline"
						aria-label={`编辑时间段 ${period.scheduleId}`}
					>
						编辑
					</Button>
					{canEnd && period.validFrom < today ? (
						<Button size="sm" variant="ghost" onClick={onEnd}>
							结束安排
						</Button>
					) : null}
					<Button
						onClick={onCopy}
						size="sm"
						variant="ghost"
						aria-label={`复制时间段 ${period.scheduleId}`}
					>
						复制
					</Button>
					<ConfirmAction
						title="删除这个时间段？"
						description="删除后将重新按照剩余时间安排展示班次。"
						confirmLabel="删除"
						onConfirm={() => remove.mutate(period.scheduleId)}
						trigger={
							<Button
								aria-label={`删除时间段 ${period.scheduleId}`}
								size="sm"
								variant="ghost"
								disabled={remove.isPending}
							>
								删除
							</Button>
						}
					/>
				</div>
			</div>
			{period.note ? <p className="mt-2 text-sm">{period.note}</p> : null}
			{period.boardingPointOverride ? (
				<p className="mt-2 text-sm">本时间段乘车点：{period.boardingPointOverride}</p>
			) : null}
			{period.status === "operating" ? (
				<Disclosure className="mt-3 text-sm">
					<DisclosureSummary className="leading-relaxed">
						<span className="font-mono">{period.items.slice(0, 4).map(itemTime).join(" · ")}</span>
						<span className="ml-2 text-info">查看全部 {period.items.length} 班</span>
					</DisclosureSummary>
					<ul className="mt-3 divide-y">
						{period.items.map((item) => (
							<li
								key={item.itemId}
								className="grid gap-1 py-2 sm:grid-cols-[10rem_5rem_minmax(0,1fr)]"
							>
								<span className="font-mono">{itemTime(item)}</span>
								<span>{riderLabel(item.riderType)}</span>
								<span>
									{item.boardingPoint ??
										period.boardingPointOverride ??
										route.defaultBoardingPoint ??
										"乘车点未填写"}
								</span>
								{item.note ? (
									<span className="text-muted-foreground sm:col-span-3">{item.note}</span>
								) : null}
								{item.capacity ? (
									<span className="text-muted-foreground sm:col-span-3">
										容量 {item.capacity} 人
									</span>
								) : null}
							</li>
						))}
					</ul>
				</Disclosure>
			) : (
				<p className="mt-2 text-sm text-muted-foreground">此期间停运</p>
			)}
			{remove.error ? <InlineError error={remove.error} title="删除失败" /> : null}
		</section>
	);
}

function periodInputWithEnd(period: TransportOpsSchedulePeriod, validTo: string) {
	return TransportOpsSchedulePeriodInputSchema.parse({
		boardingPointOverride: period.boardingPointOverride,
		items: period.items.map(({ itemId: _itemId, ...item }) => item),
		note: period.note,
		routeId: period.routeId,
		status: period.status,
		validFrom: period.validFrom,
		validTo,
		weekdays: period.weekdays,
	});
}

function periodInputForRange(
	period: TransportOpsSchedulePeriod,
	validFrom: string,
	validTo: string,
	status: "operating" | "suspended",
) {
	return TransportOpsSchedulePeriodInputSchema.parse({
		boardingPointOverride: period.boardingPointOverride,
		items: status === "suspended" ? [] : period.items.map(({ itemId: _itemId, ...item }) => item),
		note: period.note,
		routeId: period.routeId,
		status,
		validFrom,
		validTo,
		weekdays: [1, 2, 3, 4, 5, 6, 7],
	});
}
function kindLabel(kind: ServiceKind) {
	return kind === "commute" ? "两校区通勤" : kind === "subway" ? "地铁接驳" : "临时班次";
}
function weekdayLabel(days: number[]) {
	const key = [...days].sort().join(",");
	return key === "1,2,3,4,5"
		? "周一至周五"
		: key === "6,7"
			? "周六、周日"
			: key === "1,2,3,4,5,6,7"
				? "每天"
				: formatWeekdays(days);
}
function periodLabel(period: TransportOpsSchedulePeriod) {
	return `${period.validFrom} · ${weekdayLabel(period.weekdays)}`;
}
function itemTime(item: TransportOpsSchedulePeriod["items"][number]) {
	return item.kind === "fixed"
		? item.departureTime
		: `${item.firstDepartureTime}–${item.lastDepartureTime} / 每${item.intervalMinutes}分钟`;
}
function riderLabel(rider: string) {
	return rider === "all" ? "全体师生" : rider === "student" ? "学生" : "教师";
}
