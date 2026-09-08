import { Badge, Button, Card, CardContent, Input, NativeSelect, Textarea } from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import {
	type TransportOpsRoute,
	type TransportOpsRouteCreate,
	TransportOpsRouteCreateSchema,
	type TransportOpsScheduleItem,
	type TransportOpsSchedulePeriod,
	type TransportOpsSchedulePeriodInput,
	TransportOpsSchedulePeriodInputSchema,
} from "../server/transport-store-contract";
import {
	createTransportRoute,
	createTransportSchedulePeriod,
	deleteTransportRoute,
	deleteTransportSchedulePeriod,
	fetchTransportRoutes,
	fetchTransportSchedulePeriods,
	updateTransportRoute,
	updateTransportSchedulePeriod,
} from "./ops-api-client";
import { ErrorState, InlineError, PageHeader, PageShell } from "./ops-display";
import { ConfirmAction } from "./ui/alert-dialog";
import { DataTable } from "./ui/data-table";

const QUERY_ROOT = ["transport", "ops"] as const;
let nextItemKey = 0;

export function TransportPage() {
	const queryClient = useQueryClient();
	const routes = useQuery({
		queryKey: [...QUERY_ROOT, "routes"],
		queryFn: ({ signal }) => fetchTransportRoutes({ signal }),
	});
	const schedulePeriods = useQuery({
		queryKey: [...QUERY_ROOT, "schedule-periods"],
		queryFn: ({ signal }) => fetchTransportSchedulePeriods({ signal }),
	});
	const refresh = () => void queryClient.invalidateQueries({ queryKey: QUERY_ROOT });
	const queryError = routes.error ?? schedulePeriods.error;
	if (queryError && !(routes.data && schedulePeriods.data)) {
		return <ErrorState error={queryError} onRetry={refresh} title="班车数据读取失败" />;
	}
	if (!(routes.data && schedulePeriods.data)) {
		return <PageShell title="班车维护">正在读取班车数据...</PageShell>;
	}

	const routeItems = routes.data.routes;
	const routeLabels = new Map(
		routeItems.map((route) => [route.routeId, `${route.origin} → ${route.destination}`]),
	);
	return (
		<section className="mx-auto grid w-full max-w-[1600px] gap-6">
			<PageHeader
				actions={
					<Button aria-label="刷新班车数据" onClick={refresh} size="icon" variant="outline">
						<RefreshCw className={routes.isFetching ? "animate-spin" : undefined} />
					</Button>
				}
				description="直接维护学生端使用的线路、完整时间段。"
				title="班车维护"
			/>
			<div className="grid gap-8">
				<RouteSection routes={routeItems} onChanged={refresh} />
				<SchedulePeriodSection
					routes={routeItems}
					routeLabels={routeLabels}
					schedulePeriods={schedulePeriods.data.schedulePeriods}
					onChanged={refresh}
				/>
			</div>
		</section>
	);
}

function RouteSection({
	routes,
	onChanged,
}: {
	routes: TransportOpsRoute[];
	onChanged: () => void;
}) {
	const [editing, setEditing] = useState<TransportOpsRoute | "new" | null>(null);
	const remove = useMutation({ mutationFn: deleteTransportRoute, onSuccess: onChanged });
	return (
		<Section
			action={
				<Button onClick={() => setEditing("new")}>
					<Plus />
					新增线路
				</Button>
			}
			description="线路定义方向、服务类型和默认乘车点。"
			title="线路"
		>
			{remove.error ? <InlineError error={remove.error} title="线路删除失败" /> : null}
			<DataTable
				caption="班车线路"
				columns={[
					{
						cell: (route) => (
							<div>
								<p className="font-medium">
									{route.origin} → {route.destination}
								</p>
								<p className="mt-1 font-mono text-muted-foreground text-xs">{route.routeId}</p>
							</div>
						),
						header: "线路",
						rowHeader: true,
					},
					{ cell: (route) => serviceKindLabel(route.serviceKind), header: "服务类型" },
					{ cell: (route) => route.defaultBoardingPoint ?? "未设置", header: "默认乘车点" },
					{ cell: (route) => route.displayOrder, header: "顺序" },
					{
						cell: (route) => (
							<div className="flex justify-end gap-1">
								<Button
									aria-label={`编辑线路 ${route.routeId}`}
									onClick={() => setEditing(route)}
									size="icon"
									variant="ghost"
								>
									<Pencil />
								</Button>
								<ConfirmAction
									confirmLabel="删除"
									description="只有没有关联时间段的线路可以删除。"
									onConfirm={() => remove.mutate(route.routeId)}
									title="删除这条线路？"
									trigger={
										<Button
											aria-label={`删除线路 ${route.routeId}`}
											disabled={remove.isPending}
											size="icon"
											variant="ghost"
										>
											<Trash2 />
										</Button>
									}
								/>
							</div>
						),
						header: "操作",
					},
				]}
				data={routes}
				emptyMessage="尚未配置线路。"
				rowKey={(route) => route.routeId}
			/>
			<RouteForm
				key={editorKey(editing, "routeId")}
				editing={editing}
				onChanged={onChanged}
				onClose={() => setEditing(null)}
			/>
		</Section>
	);
}

function SchedulePeriodSection({
	routes,
	routeLabels,
	schedulePeriods,
	onChanged,
}: {
	routes: TransportOpsRoute[];
	routeLabels: ReadonlyMap<string, string>;
	schedulePeriods: TransportOpsSchedulePeriod[];
	onChanged: () => void;
}) {
	const [editing, setEditing] = useState<TransportOpsSchedulePeriod | "new" | null>(null);
	const remove = useMutation({ mutationFn: deleteTransportSchedulePeriod, onSuccess: onChanged });
	return (
		<Section
			action={
				<Button disabled={routes.length === 0} onClick={() => setEditing("new")}>
					<Plus />
					新增时间段
				</Button>
			}
			description="每个时间段包含日期范围、运行状态和完整班次明细；保存时整体替换明细。"
			title="班次时间段"
		>
			{remove.error ? <InlineError error={remove.error} title="时间段删除失败" /> : null}
			<DataTable
				caption="班车时间段"
				columns={[
					{
						cell: (period) => (
							<div>
								<p className="font-medium">{routeLabels.get(period.routeId) ?? period.routeId}</p>
								<p className="mt-1 font-mono text-muted-foreground text-xs">{period.scheduleId}</p>
							</div>
						),
						header: "线路",
						rowHeader: true,
					},
					{ cell: (period) => periodRangeLabel(period), header: "适用日期" },
					{ cell: (period) => statusLabel(period.status), header: "状态" },
					{ cell: (period) => `${period.items.length} 条班次`, header: "班次明细" },
					{ cell: (period) => period.boardingPointOverride ?? "沿用线路默认值", header: "乘车点" },
					{
						cell: (period) => (
							<div className="flex justify-end gap-1">
								<Button
									aria-label={`编辑时间段 ${period.scheduleId}`}
									onClick={() => setEditing(period)}
									size="icon"
									variant="ghost"
								>
									<Pencil />
								</Button>
								<ConfirmAction
									confirmLabel="删除"
									description="删除后对应日期不再有这段班次。"
									onConfirm={() => remove.mutate(period.scheduleId)}
									title="删除这个时间段？"
									trigger={
										<Button
											aria-label={`删除时间段 ${period.scheduleId}`}
											disabled={remove.isPending}
											size="icon"
											variant="ghost"
										>
											<Trash2 />
										</Button>
									}
								/>
							</div>
						),
						header: "操作",
					},
				]}
				data={schedulePeriods}
				emptyMessage="尚未配置班次时间段。"
				rowKey={(period) => period.scheduleId}
			/>
			<SchedulePeriodForm
				key={editorKey(editing, "scheduleId")}
				editing={editing}
				onChanged={onChanged}
				onClose={() => setEditing(null)}
				routes={routes}
			/>
		</Section>
	);
}

function RouteForm({
	editing,
	onChanged,
	onClose,
}: {
	editing: TransportOpsRoute | "new" | null;
	onChanged: () => void;
	onClose: () => void;
}) {
	const [form, setForm] = useState<TransportOpsRouteCreate>(() => routeForm(editing));
	const [error, setError] = useState<unknown>(null);
	const mutation = useMutation({
		mutationFn: (value: TransportOpsRouteCreate) =>
			editing && editing !== "new"
				? updateTransportRoute(editing.routeId, value)
				: createTransportRoute(value),
		onSuccess: () => {
			onClose();
			onChanged();
		},
	});
	if (editing === null) {
		return null;
	}
	const submit = (event: FormEvent) => {
		event.preventDefault();
		try {
			const value = TransportOpsRouteCreateSchema.parse(form);
			setError(null);
			mutation.mutate(value);
		} catch (caught) {
			setError(caught);
		}
	};
	return (
		<EditorCard title={editing === "new" ? "新增线路" : "编辑线路"} onClose={onClose}>
			<form className="grid gap-4" onSubmit={submit}>
				<TextField
					label="线路标识"
					onChange={(value) => setForm({ ...form, routeId: value })}
					readOnly={editing !== "new"}
					value={form.routeId}
				/>
				<div className="grid gap-4 md:grid-cols-2">
					<TextField
						label="起点"
						onChange={(value) => setForm({ ...form, origin: value })}
						value={form.origin}
					/>
					<TextField
						label="终点"
						onChange={(value) => setForm({ ...form, destination: value })}
						value={form.destination}
					/>
				</div>
				<div className="grid gap-4 md:grid-cols-3">
					<SelectField
						label="服务类型"
						onChange={(value) =>
							setForm({ ...form, serviceKind: value as TransportOpsRouteCreate["serviceKind"] })
						}
						options={[
							["commute", "两校区通勤"],
							["subway", "地铁接驳"],
							["special", "临时班次"],
						]}
						value={form.serviceKind}
					/>
					<TextField
						label="默认乘车点"
						onChange={(value) => setForm({ ...form, defaultBoardingPoint: value || null })}
						value={form.defaultBoardingPoint ?? ""}
					/>
					<TextField
						label="显示顺序"
						onChange={(value) => setForm({ ...form, displayOrder: Number(value) })}
						value={String(form.displayOrder)}
					/>
				</div>
				{error || mutation.error ? (
					<InlineError error={error ?? mutation.error} title="线路保存失败" />
				) : null}
				<EditorActions busy={mutation.isPending} onClose={onClose} />
			</form>
		</EditorCard>
	);
}

function SchedulePeriodForm({
	editing,
	onChanged,
	onClose,
	routes,
}: {
	editing: TransportOpsSchedulePeriod | "new" | null;
	onChanged: () => void;
	onClose: () => void;
	routes: TransportOpsRoute[];
}) {
	const [form, setForm] = useState(() => schedulePeriodForm(editing));
	const [error, setError] = useState<unknown>(null);
	const mutation = useMutation({
		mutationFn: (value: TransportOpsSchedulePeriodInput) =>
			editing && editing !== "new"
				? updateTransportSchedulePeriod(editing.scheduleId, value)
				: createTransportSchedulePeriod(value),
		onSuccess: () => {
			onClose();
			onChanged();
		},
	});
	if (editing === null) {
		return null;
	}
	const submit = (event: FormEvent) => {
		event.preventDefault();
		try {
			const value = parseSchedulePeriodForm(form);
			setError(null);
			mutation.mutate(value);
		} catch (caught) {
			setError(caught);
		}
	};
	return (
		<EditorCard title={editing === "new" ? "新增时间段" : "编辑时间段"} onClose={onClose}>
			<form className="grid gap-4" onSubmit={submit}>
				<div className="grid gap-4 md:grid-cols-3">
					<RouteSelect
						routes={routes}
						value={form.routeId}
						onChange={(value) => setForm({ ...form, routeId: value })}
					/>
					<TextField
						label="开始日期"
						onChange={(value) => setForm({ ...form, validFrom: value })}
						type="date"
						value={form.validFrom}
					/>
					<TextField
						label="结束日期（可空）"
						onChange={(value) => setForm({ ...form, validTo: value })}
						type="date"
						value={form.validTo}
					/>
				</div>
				<div className="grid gap-4 md:grid-cols-3">
					<SelectField
						label="状态"
						onChange={(value) =>
							setForm({
								...form,
								status: value as SchedulePeriodFormState["status"],
								items: value === "suspended" ? [] : form.items,
							})
						}
						options={[
							["operating", "运行"],
							["suspended", "停运"],
						]}
						value={form.status}
					/>
					<TextField
						label="乘车点覆盖"
						onChange={(value) => setForm({ ...form, boardingPointOverride: value })}
						value={form.boardingPointOverride}
					/>
					<TextField
						label="星期（1-7，用逗号分隔）"
						onChange={(value) => setForm({ ...form, weekdays: value })}
						value={form.weekdays}
					/>
				</div>
				<TextareaField
					label="备注"
					onChange={(value) => setForm({ ...form, note: value })}
					value={form.note}
				/>
				<div className="grid gap-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h3 className="font-medium text-sm">班次明细</h3>
						<Button
							disabled={form.status === "suspended"}
							onClick={() => setForm({ ...form, items: [...form.items, emptyItem()] })}
							size="sm"
							variant="outline"
						>
							<Plus />
							添加班次
						</Button>
					</div>
					{form.items.length === 0 ? (
						<p className="text-muted-foreground text-sm">停运时间段不需要班次明细。</p>
					) : (
						<div className="grid gap-3">
							{form.items.map((item, index) => (
								<ItemEditor
									index={index}
									item={item}
									key={item.itemKey}
									onChange={(next) =>
										setForm({
											...form,
											items: form.items.map((current, itemIndex) =>
												itemIndex === index ? next : current,
											),
										})
									}
									onRemove={() =>
										setForm({
											...form,
											items: form.items.filter((_, itemIndex) => itemIndex !== index),
										})
									}
								/>
							))}
						</div>
					)}
				</div>
				{error || mutation.error ? (
					<InlineError error={error ?? mutation.error} title="时间段保存失败" />
				) : null}
				<EditorActions busy={mutation.isPending} onClose={onClose} />
			</form>
		</EditorCard>
	);
}

function ItemEditor({
	index,
	item,
	onChange,
	onRemove,
}: {
	index: number;
	item: ItemFormState;
	onChange: (item: ItemFormState) => void;
	onRemove: () => void;
}) {
	return (
		<div className="grid gap-3 rounded-md border border-border p-3">
			<div className="flex items-center justify-between gap-2">
				<p className="font-medium text-sm">班次 {index + 1}</p>
				<Button aria-label={`删除班次 ${index + 1}`} onClick={onRemove} size="icon" variant="ghost">
					<Trash2 />
				</Button>
			</div>
			<div className="grid gap-3 md:grid-cols-4">
				<SelectField
					label="模式"
					onChange={(value) => onChange({ ...item, kind: value as ItemFormState["kind"] })}
					options={[
						["fixed", "固定时间"],
						["interval", "时间间隔"],
					]}
					value={item.kind}
				/>
				<SelectField
					label="乘车人群"
					onChange={(value) =>
						onChange({ ...item, riderType: value as ItemFormState["riderType"] })
					}
					options={[
						["all", "全体师生"],
						["student", "学生"],
						["teacher", "教师"],
					]}
					value={item.riderType}
				/>
				<TextField
					label="容量（可空）"
					onChange={(value) => onChange({ ...item, capacity: value })}
					value={item.capacity}
					type="number"
				/>
				{item.kind === "fixed" ? (
					<TextField
						label="发车时间"
						onChange={(value) => onChange({ ...item, departureTime: value })}
						value={item.departureTime}
						type="time"
					/>
				) : (
					<TextField
						label="间隔分钟"
						onChange={(value) => onChange({ ...item, intervalMinutes: value })}
						value={item.intervalMinutes}
						type="number"
					/>
				)}
			</div>
			{item.kind === "interval" ? (
				<div className="grid gap-3 md:grid-cols-2">
					<TextField
						label="首班时间"
						onChange={(value) => onChange({ ...item, firstDepartureTime: value })}
						value={item.firstDepartureTime}
						type="time"
					/>
					<TextField
						label="末班时间"
						onChange={(value) => onChange({ ...item, lastDepartureTime: value })}
						value={item.lastDepartureTime}
						type="time"
					/>
				</div>
			) : null}
			<TextField
				label="班次乘车点（留空沿用公共乘车点）"
				value={item.boardingPoint}
				onChange={(value) => onChange({ ...item, boardingPoint: value })}
			/>
			<TextareaField
				label="班次备注"
				onChange={(value) => onChange({ ...item, note: value })}
				value={item.note}
			/>
		</div>
	);
}

function Section({
	action,
	children,
	description,
	title,
}: {
	action?: ReactNode;
	children: ReactNode;
	description: string;
	title: string;
}) {
	return (
		<section className="grid gap-3">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 className="font-semibold text-xl text-foreground">{title}</h2>
					<p className="mt-1 text-muted-foreground text-sm">{description}</p>
				</div>
				{action}
			</div>
			{children}
		</section>
	);
}

function EditorCard({
	children,
	onClose,
	title,
}: {
	children: ReactNode;
	onClose: () => void;
	title: string;
}) {
	return (
		<Card>
			<CardContent className="grid gap-4 p-4">
				<div className="flex items-center justify-between gap-3">
					<h3 className="font-semibold text-lg">{title}</h3>
					<Button onClick={onClose} size="sm" variant="ghost">
						取消
					</Button>
				</div>
				{children}
			</CardContent>
		</Card>
	);
}

function EditorActions({ busy, onClose }: { busy: boolean; onClose: () => void }) {
	return (
		<div className="flex justify-end gap-2">
			<Button onClick={onClose} variant="outline">
				取消
			</Button>
			<Button disabled={busy} type="submit">
				保存
			</Button>
		</div>
	);
}

function RouteSelect({
	routes,
	value,
	onChange,
}: {
	routes: TransportOpsRoute[];
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<SelectField
			label="线路"
			onChange={onChange}
			options={[
				["", "选择线路"],
				...routes.map(
					(route) => [route.routeId, `${route.origin} → ${route.destination}`] as [string, string],
				),
			]}
			value={value}
		/>
	);
}

function TextField({
	label,
	onChange,
	readOnly,
	type = "text",
	value,
}: {
	label: string;
	onChange: (value: string) => void;
	readOnly?: boolean;
	type?: string;
	value: string;
}) {
	const id = useId();
	return (
		<label className="grid gap-1 text-sm" htmlFor={id}>
			<span className="font-medium">{label}</span>
			<Input
				id={id}
				onChange={(event) => onChange(event.target.value)}
				readOnly={readOnly}
				type={type}
				value={value}
			/>
		</label>
	);
}

function TextareaField({
	label,
	onChange,
	value,
}: {
	label: string;
	onChange: (value: string) => void;
	value: string;
}) {
	const id = useId();
	return (
		<label className="grid gap-1 text-sm" htmlFor={id}>
			<span className="font-medium">{label}</span>
			<Textarea id={id} onChange={(event) => onChange(event.target.value)} value={value} />
		</label>
	);
}

function SelectField({
	label,
	onChange,
	options,
	value,
}: {
	label: string;
	onChange: (value: string) => void;
	options: [string, string][];
	value: string;
}) {
	const id = useId();
	return (
		<label className="grid gap-1 text-sm" htmlFor={id}>
			<span className="font-medium">{label}</span>
			<NativeSelect id={id} onChange={(event) => onChange(event.target.value)} value={value}>
				{options.map(([option, text]) => (
					<option key={option} value={option}>
						{text}
					</option>
				))}
			</NativeSelect>
		</label>
	);
}

interface SchedulePeriodFormState {
	boardingPointOverride: string;
	items: ItemFormState[];
	note: string;
	routeId: string;
	status: "operating" | "suspended";
	validFrom: string;
	validTo: string;
	weekdays: string;
}

interface ItemFormState {
	boardingPoint: string;
	capacity: string;
	departureTime: string;
	firstDepartureTime: string;
	intervalMinutes: string;
	itemKey: string;
	kind: "fixed" | "interval";
	lastDepartureTime: string;
	note: string;
	riderType: "all" | "student" | "teacher";
}

function routeForm(editing: TransportOpsRoute | "new" | null): TransportOpsRouteCreate {
	if (editing && editing !== "new") {
		return {
			defaultBoardingPoint: editing.defaultBoardingPoint,
			destination: editing.destination,
			displayOrder: editing.displayOrder,
			origin: editing.origin,
			routeId: editing.routeId,
			serviceKind: editing.serviceKind,
		};
	}
	return {
		defaultBoardingPoint: null,
		destination: "",
		displayOrder: 0,
		origin: "",
		routeId: "",
		serviceKind: "commute",
	};
}

function schedulePeriodForm(
	editing: TransportOpsSchedulePeriod | "new" | null,
): SchedulePeriodFormState {
	if (editing && editing !== "new") {
		return {
			boardingPointOverride: editing.boardingPointOverride ?? "",
			items: editing.items.map(itemForm),
			note: editing.note ?? "",
			routeId: editing.routeId,
			status: editing.status,
			validFrom: editing.validFrom,
			validTo: editing.validTo ?? "",
			weekdays: editing.weekdays.join(","),
		};
	}
	return {
		boardingPointOverride: "",
		items: [emptyItem()],
		note: "",
		routeId: "",
		status: "operating",
		validFrom: "",
		validTo: "",
		weekdays: "1,2,3,4,5",
	};
}

function itemForm(item: TransportOpsScheduleItem): ItemFormState {
	return {
		boardingPoint: item.boardingPoint ?? "",
		capacity: item.capacity === null ? "" : String(item.capacity),
		departureTime: item.kind === "fixed" ? item.departureTime : "",
		firstDepartureTime: item.kind === "interval" ? item.firstDepartureTime : "",
		intervalMinutes: item.kind === "interval" ? String(item.intervalMinutes) : "20",
		itemKey: item.itemId,
		kind: item.kind,
		lastDepartureTime: item.kind === "interval" ? item.lastDepartureTime : "",
		note: item.note ?? "",
		riderType: item.riderType,
	};
}

function emptyItem(): ItemFormState {
	return {
		boardingPoint: "",
		capacity: "",
		departureTime: "08:00",
		firstDepartureTime: "08:00",
		intervalMinutes: "20",
		itemKey: `new-item-${nextItemKey++}`,
		kind: "fixed",
		lastDepartureTime: "10:00",
		note: "",
		riderType: "all",
	};
}

function parseSchedulePeriodForm(form: SchedulePeriodFormState): TransportOpsSchedulePeriodInput {
	const weekdays = form.weekdays
		.split(/[,，\s]+/u)
		.filter(Boolean)
		.map((value) => Number(value));
	const items =
		form.status === "suspended"
			? []
			: form.items.map((item, sortOrder) => {
					const capacity = item.capacity.trim() ? Number(item.capacity) : null;
					if (item.kind === "fixed") {
						return {
							boardingPoint: item.boardingPoint.trim() || null,
							capacity,
							departureTime: item.departureTime,
							kind: "fixed" as const,
							note: item.note.trim() || null,
							riderType: item.riderType,
							sortOrder,
						};
					}
					return {
						boardingPoint: item.boardingPoint.trim() || null,
						capacity,
						firstDepartureTime: item.firstDepartureTime,
						intervalMinutes: Number(item.intervalMinutes),
						kind: "interval" as const,
						lastDepartureTime: item.lastDepartureTime,
						note: item.note.trim() || null,
						riderType: item.riderType,
						sortOrder,
					};
				});
	return TransportOpsSchedulePeriodInputSchema.parse({
		boardingPointOverride: form.boardingPointOverride.trim() || null,
		items,
		note: form.note.trim() || null,
		routeId: form.routeId,
		status: form.status,
		validFrom: form.validFrom,
		validTo: form.validTo.trim() || null,
		weekdays,
	});
}

function editorKey<T extends Record<K, string>, K extends keyof T>(
	editing: T | "new" | null,
	id: K,
): string {
	if (editing === null) {
		return "closed";
	}
	if (editing === "new") {
		return "new";
	}
	return editing[id];
}

function periodRangeLabel(
	period: Pick<TransportOpsSchedulePeriod, "validFrom" | "validTo" | "weekdays">,
): string {
	return `${period.validFrom} 至 ${period.validTo ?? "长期"} · 周${period.weekdays.join("、")}`;
}

function statusLabel(status: "operating" | "suspended"): ReactNode {
	return (
		<Badge tone={status === "operating" ? "success" : "danger"}>
			{status === "operating" ? "运行" : "停运"}
		</Badge>
	);
}

function serviceKindLabel(kind: TransportOpsRoute["serviceKind"]): string {
	return kind === "commute" ? "两校区通勤" : kind === "subway" ? "地铁接驳" : "临时班次";
}
