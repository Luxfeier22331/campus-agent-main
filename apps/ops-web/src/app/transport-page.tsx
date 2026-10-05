import { ActionGroup, Card, Field, StateMessage } from "@campus-agent/ui";
import { FilterSelect } from "./ui/filter-select";
import "./transport-page.css";
import {
	formatWeekdays,
	selectTransportPeriod,
	shiftTransportDate,
	transportPeriodIncludesDate,
} from "@campus-agent/transport/domain";
import {
	Badge,
	Button,
	ConfirmDialog,
	cn,
	Disclosure,
	DisclosureSummary,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
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
import { TransportNoticeLinkEditor } from "./transport-notice-links";
import { useConfirmCommand } from "./use-confirm-command";

function weekdayOf(date: string) {
	const day = new Date(`${date}T00:00:00Z`).getUTCDay();
	return day === 0 ? 7 : day;
}

const QUERY_ROOT = ["transport", "ops"] as const;
const KINDS = ["commute", "subway", "special"] as const;
type ServiceKind = (typeof KINDS)[number];
type Editor =
	| { type: "route"; source: TransportOpsRoute | null }
	| { type: "notices"; source: TransportOpsSchedulePeriod }
	| {
			type: "period";
			source: TransportOpsSchedulePeriod | null;
			copy: boolean;
			initial?: TransportOpsSchedulePeriodInput;
			quickAction?: { kind: "add" | "edit" | "cancel"; index: number };
	  };

export function TransportPage({
	initialScheduleId,
	requestedKind,
}: {
	initialScheduleId?: string | undefined;
	requestedKind?: ServiceKind | undefined;
} = {}) {
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
			<section>
				<PageHeader title="班车维护" />
				<ErrorState error={error} onRetry={refresh} title="班车数据读取失败" />
			</section>
		) : (
			<PageShell title="班车维护">正在读取班车数据…</PageShell>
		);
	}
	return (
		<TransportWorkspace
			initialScheduleId={initialScheduleId}
			requestedKindProp={requestedKind}
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
	initialScheduleId,
	requestedKindProp,
}: {
	routes: TransportOpsRoute[];
	periods: TransportOpsSchedulePeriod[];
	onChanged: () => void;
	refreshing: boolean;
	error: unknown;
	initialScheduleId?: string | undefined;
	requestedKindProp?: ServiceKind | undefined;
}) {
	const target = periods.find((period) => period.scheduleId === initialScheduleId);
	const targetRoute = routes.find((route) => route.routeId === target?.routeId);
	const kinds = KINDS.filter((kind) => routes.some((route) => route.serviceKind === kind));
	const requestedKind = requestedKindProp ?? targetRoute?.serviceKind ?? kinds[0] ?? "commute";
	const kind = kinds.includes(requestedKind) ? requestedKind : (kinds[0] ?? "commute");
	const kindRoutes = routes.filter((route) => route.serviceKind === kind);
	const [selectedId, setSelectedId] = useState<string | undefined>(targetRoute?.routeId);
	const selected = kindRoutes.find((route) => route.routeId === selectedId) ?? kindRoutes[0];
	const routePeriods = periods.filter((period) => period.routeId === selected?.routeId);
	const [editor, setEditor] = useState<Editor | null>(
		target ? { type: "period", source: target, copy: false } : null,
	);
	const [dirty, setDirty] = useState(false);
	const [busy, setBusy] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const navigate = useNavigate({ from: "/transport" });
	const resolvedEntry = useRef(initialScheduleId);
	const blocker = useBlocker({
		disabled: !(dirty || busy),
		shouldBlockFn: () => dirty || busy,
		enableBeforeUnload: dirty || busy,
		withResolver: true,
	});
	useEffect(() => {
		if (busy && blocker.status === "blocked") {
			blocker.reset();
		}
	}, [busy, blocker]);
	const pendingAction = useRef<(() => void) | null>(null);
	const editorRef = useRef<HTMLDivElement>(null);
	// Only called after the local leave guard, or a successful save.
	const clearEntry = () => {
		if (!initialScheduleId) {
			return;
		}
		resolvedEntry.current = undefined;
		void navigate({
			to: "/transport",
			search: { kind },
			replace: true,
			resetScroll: false,
			ignoreBlocker: true,
		});
	};
	const close = () => {
		setEditor(null);
		setDirty(false);
		setBusy(false);
		clearEntry();
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
	const begin = (next: Editor) =>
		guard(() => {
			setDirty(false);
			clearEntry();
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
			setSelectedId(undefined);
			void navigate({
				search: { kind: value as ServiceKind },
				to: "/transport",
				ignoreBlocker: true,
			});
		});
	const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
	const [viewDate, setViewDate] = useState(target?.validFrom ?? today);
	const [calendarMonth, setCalendarMonth] = useState(
		`${(target?.validFrom ?? today).slice(0, 7)}-01`,
	);
	useEffect(() => {
		if (resolvedEntry.current === initialScheduleId) {
			return;
		}
		resolvedEntry.current = initialScheduleId;
		setDirty(false);
		setBusy(false);
		setEditor(target ? { type: "period", source: target, copy: false } : null);
		if (target && targetRoute) {
			setSelectedId(targetRoute.routeId);
			setViewDate(target.validFrom);
			setCalendarMonth(`${target.validFrom.slice(0, 7)}-01`);
		}
	}, [initialScheduleId, target, targetRoute]);
	const effective = selectTransportPeriod(routePeriods, viewDate);
	const quickEdit = (action: "add" | "edit" | "cancel", index = 0) => {
		if (!selected) {
			return;
		}
		const initial = effective
			? periodInputForRange(effective, viewDate, viewDate, effective.status)
			: {
					routeId: selected.routeId,
					validFrom: viewDate,
					validTo: viewDate,
					weekdays: [weekdayOf(viewDate)],
					status: "operating" as const,
					items: [],
					boardingPointOverride: null,
					note: null,
				};
		if (action === "add") {
			initial.status = "operating";
		}
		if (action === "cancel") {
			initial.items = initial.items
				.filter((_, i) => i !== index)
				.map((item, sortOrder) => ({ ...item, sortOrder }));
			if (initial.items.length === 0) {
				initial.status = "suspended";
			}
		}
		begin({
			type: "period",
			source: effective,
			copy: true,
			initial,
			quickAction: { kind: action, index: action === "add" ? initial.items.length : index },
		});
	};
	return (
		<section className="ops-transport-workspace mx-auto w-full max-w-[1440px]">
			<PageHeader
				title="班车维护"
				description="选择服务和线路，查看生效班次，维护时间段与关联通知。"
				actions={
					<ActionGroup>
						<Button
							aria-label="刷新班车数据"
							disabled={refreshing || busy}
							size="icon"
							variant="ghost"
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
					</ActionGroup>
				}
			/>
			{error ? <InlineError error={error} title="刷新失败，仍显示已有班车数据" /> : null}
			{initialScheduleId && !target ? (
				<div className="grid gap-3 rounded border p-4">
					<StateMessage
						layout="inline"
						role="alert"
						tone="danger"
						description={<> 所关联的时间段不存在或已删除。 </>}
					/>
					<Button className="justify-self-start" variant="ghost" onClick={() => guard(close)}>
						返回班车维护
					</Button>
				</div>
			) : null}
			<Tabs value={kind} onValueChange={selectKind}>
				<TabsList aria-label="班车服务类型" presentation="segmented">
					{kinds.map((item) => (
						<TabsTrigger key={item} value={item}>
							{kindLabel(item)}
						</TabsTrigger>
					))}
				</TabsList>
				<TabsContent value={kind} className="mt-4">
					<div className="ops-transport-columns grid items-start gap-5">
						<div className="min-w-0">
							<Field label="线路方向" className="ops-transport-route-picker">
								<FilterSelect
									id="ops-transport-route"
									value={selected?.routeId ?? ""}
									onValueChange={(nextValue) => selectRoute(nextValue)}
									options={kindRoutes.map((route) => ({
										value: route.routeId,
										label: `${route.origin} → ${route.destination}`,
									}))}
								/>
							</Field>
							<nav aria-label="班车线路" className="ops-transport-route-list gap-2">
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
												"grid select-none gap-1.5 rounded-md border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
												selected?.routeId === route.routeId
													? "border-border-selected bg-selected text-selected-foreground hover:bg-selected-hover active:bg-selected-pressed"
													: "border-transparent hover:bg-surface-hover active:bg-surface-pressed",
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
							{editor?.type === "notices" ? (
								<TransportNoticeLinkEditor
									key={editor.source.scheduleId}
									scheduleId={editor.source.scheduleId}
									onDirty={setDirty}
									onBusy={setBusy}
									onCancel={() => guard(close)}
									onSaved={close}
								/>
							) : editor?.type === "route" ? (
								<TransportRouteEditor
									key={editor.source?.routeId ?? "new"}
									source={editor.source}
									kind={kind}
									onDirty={setDirty}
									onBusy={setBusy}
									onCancel={() => guard(close)}
									onSaved={(route) => {
										close();
										void navigate({
											to: "/transport",
											search: { kind: route.serviceKind },
											ignoreBlocker: true,
										});
										setSelectedId(route.routeId);
										onChanged();
									}}
								/>
							) : editor?.type === "period" && selected ? (
								<TransportPeriodEditor
									key={`${editor.copy ? "copy" : "edit"}-${editor.source?.scheduleId ?? "new"}`}
									source={editor.source}
									copy={editor.copy}
									quickAction={editor.quickAction}
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
							) : initialScheduleId && !target ? null : selected ? (
								<div className="grid gap-5">
									<div className="ops-transport-day grid items-start gap-4">
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
										<Card asChild>
											<section aria-label="当天有效班次" className="grid gap-3 p-4 md:p-5">
												<div className="flex flex-wrap items-center justify-between gap-2">
													<h3 className="font-semibold">{viewDate} · 当天有效班次</h3>
													<Button onClick={() => quickEdit("add")}>新增班次</Button>
													{effective ? (
														<Button
															variant="secondary"
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
												{effective?.status === "operating" ? (
													<p className="text-sm">
														下车点：
														{effective.dropOffPointOverride ?? selected.dropOffPoint ?? "未填写"}
													</p>
												) : null}
												{effective?.status === "operating" ? (
													<ul className="divide-y">
														{effective.items.map((item, index) => (
															<li key={item.itemId} className="grid gap-2 py-3">
																<div className="flex flex-wrap items-center justify-between gap-2">
																	<span className="font-mono">
																		{itemTime(item)} · {riderLabel(item.riderType)}
																	</span>
																	<ActionGroup>
																		<Button
																			size="sm"
																			variant="ghost"
																			aria-label={`修改班次 ${itemTime(item)} ${riderLabel(item.riderType)}`}
																			onClick={() => quickEdit("edit", index)}
																		>
																			修改
																		</Button>
																		<Button
																			size="sm"
																			variant="ghost"
																			aria-label={`取消班次 ${itemTime(item)} ${riderLabel(item.riderType)}`}
																			onClick={() => quickEdit("cancel", index)}
																		>
																			取消班次
																		</Button>
																	</ActionGroup>
																</div>
																<p className="text-sm">
																	{item.boardingPoint ??
																		effective.boardingPointOverride ??
																		selected.defaultBoardingPoint ??
																		"乘车点未填写"}
																</p>
																{item.note ? (
																	<p className="text-sm text-muted-foreground">{item.note}</p>
																) : null}
															</li>
														))}
													</ul>
												) : (
													<p className="text-sm">
														{effectiveDetails(effective, selected).join("\n")}
													</p>
												)}
											</section>
										</Card>
									</div>
									<RouteDetails
										route={selected}
										periods={routePeriods}
										selectedScheduleId={initialScheduleId}
										onNotices={(period) => begin({ type: "notices", source: period })}
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
			<ConfirmDialog
				open={confirmOpen || (!busy && blocker.status === "blocked")}
				pending={busy}
				onOpenChange={(open) => {
					setConfirmOpen(open);
					if (!open) {
						pendingAction.current = null;
						if (blocker.status === "blocked") {
							blocker.reset();
						}
					}
				}}
				title="放弃未保存的修改？"
				description="当前修改尚未保存。"
				cancelLabel="继续编辑"
				confirmLabel="放弃修改"
				onConfirm={() => {
					setDirty(false);
					setConfirmOpen(false);
					if (blocker.status === "blocked") {
						blocker.proceed();
						return;
					}
					const action = pendingAction.current;
					pendingAction.current = null;
					action?.();
				}}
			/>
		</section>
	);
}

function RouteDetails({
	selectedScheduleId,
	route,
	periods,
	today,
	onChanged,
	onEditRoute,
	onNew,
	onEdit,
	onCopy,
	onEnd,
	onNotices,
}: {
	selectedScheduleId?: string | undefined;
	route: TransportOpsRoute;
	periods: TransportOpsSchedulePeriod[];
	today: string;
	onChanged: () => void;
	onEditRoute: () => void;
	onNew: () => void;
	onEdit: (period: TransportOpsSchedulePeriod) => void;
	onCopy: (period: TransportOpsSchedulePeriod) => void;
	onEnd: (period: TransportOpsSchedulePeriod) => void;
	onNotices: (period: TransportOpsSchedulePeriod) => void;
}) {
	const confirmCommand = useConfirmCommand();

	const remove = useMutation({ mutationFn: deleteTransportRoute, onSuccess: onChanged });
	const [showHistorical, setShowHistorical] = useState(
		Boolean(
			selectedScheduleId &&
				periods.some(
					(period) =>
						period.scheduleId === selectedScheduleId && period.validTo && period.validTo < today,
				),
		),
	);
	useEffect(() => {
		if (
			selectedScheduleId &&
			periods.some(
				(period) =>
					period.scheduleId === selectedScheduleId && period.validTo && period.validTo < today,
			)
		) {
			setShowHistorical(true);
		}
	}, [selectedScheduleId, periods, today]);
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
					<Button variant="secondary" onClick={onEditRoute}>
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
				<StateMessage layout="inline" description="这条线路还没有时间安排。" />
			) : null}
			{groups.find((group) => group.label === "已结束")?.entries.length ? (
				<Button
					size="sm"
					variant="ghost"
					aria-expanded={showHistorical}
					onClick={() => setShowHistorical((value) => !value)}
				>
					{showHistorical
						? "收起已结束安排"
						: `显示已结束安排（${groups.find((group) => group.label === "已结束")?.entries.length}）`}
				</Button>
			) : null}
			{groups
				.filter((group) => group.entries.length > 0 && (group.label !== "已结束" || showHistorical))
				.map((group) => (
					<section key={group.label} className="grid gap-2" aria-label={group.label}>
						<h4 className="text-sm text-muted-foreground">{group.label}</h4>
						{[...group.entries]
							.sort((a, b) => b.validFrom.localeCompare(a.validFrom))
							.map((period) => (
								<PeriodCard
									key={period.scheduleId}
									period={period}
									onNotices={() => onNotices(period)}
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
				<ConfirmDialog
					title="删除这条线路？"
					description="请先删除该线路关联的时间安排。"
					confirmLabel="删除线路"
					{...confirmCommand(route.routeId, () => remove.mutateAsync(route.routeId))}
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
	onNotices,
}: {
	period: TransportOpsSchedulePeriod;
	route: TransportOpsRoute;
	today: string;
	onChanged: () => void;
	onEdit: () => void;
	onCopy: () => void;
	onEnd: () => void;
	canEnd: boolean;
	onNotices: () => void;
}) {
	const confirmCommand = useConfirmCommand();

	const remove = useMutation({ mutationFn: deleteTransportSchedulePeriod, onSuccess: onChanged });
	return (
		<Card asChild>
			<section className="p-4 md:p-5" aria-label={periodLabel(period)}>
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
					<ActionGroup>
						<Button
							size="sm"
							variant="ghost"
							onClick={onNotices}
							aria-label={`关联通知 ${period.scheduleId}`}
						>
							关联通知
						</Button>
						<Button
							onClick={onEdit}
							size="sm"
							variant="ghost"
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
						<ConfirmDialog
							title="删除这个时间段？"
							description="删除后将重新按照剩余时间安排展示班次。"
							confirmLabel="删除"
							{...confirmCommand(period.scheduleId, () => remove.mutateAsync(period.scheduleId))}
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
					</ActionGroup>
				</div>
				{period.note ? <p className="mt-2 text-sm">{period.note}</p> : null}
				{period.boardingPointOverride ? (
					<p className="mt-2 text-sm">本时间段乘车点：{period.boardingPointOverride}</p>
				) : null}
				{period.dropOffPointOverride ? (
					<p className="mt-2 text-sm">本时间段下车点：{period.dropOffPointOverride}</p>
				) : null}
				{period.status === "operating" ? (
					<Disclosure className="mt-3 text-sm">
						<DisclosureSummary className="leading-relaxed">
							<span className="font-mono">
								{period.items.slice(0, 4).map(itemTime).join(" · ")}
							</span>
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
		</Card>
	);
}

function periodInputWithEnd(period: TransportOpsSchedulePeriod, validTo: string) {
	return TransportOpsSchedulePeriodInputSchema.parse({
		boardingPointOverride: period.boardingPointOverride,
		dropOffPointOverride: period.dropOffPointOverride,
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
		dropOffPointOverride: period.dropOffPointOverride,
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
