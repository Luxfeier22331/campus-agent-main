import { formatWeekdays } from "@campus-agent/transport/domain";
import {
	Button,
	Disclosure,
	DisclosureSummary,
	Field,
	Input,
	NativeSelect,
	Textarea,
	ToggleGroup,
	ToggleGroupItem,
} from "@campus-agent/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type FormEvent,
	type ReactNode,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { z } from "zod";
import {
	type TransportNoticeLink,
	type TransportOpsRoute,
	type TransportOpsRouteCreate,
	TransportOpsRouteCreateSchema,
	type TransportOpsSchedulePeriod,
	type TransportOpsSchedulePeriodInput,
	TransportOpsSchedulePeriodInputSchema,
} from "../server/transport-store-contract";
import {
	createTransportRoute,
	createTransportSchedulePeriod,
	updateTransportRoute,
	updateTransportSchedulePeriod,
} from "./ops-api-client";
import { InlineError } from "./ops-display";
import { TransportImpact } from "./transport-impact";
import { TransportNoticePicker } from "./transport-notice-links";

interface EditorEvents {
	onDirty: (dirty: boolean) => void;
	onBusy: (busy: boolean) => void;
	onCancel: () => void;
}
const Errors = createContext<Record<string, string>>({});
function useDraft<T>(create: () => T, onDirty: EditorEvents["onDirty"]) {
	const [initial] = useState(create);
	const [form, setForm] = useState(initial);
	const dirty = JSON.stringify(form) !== JSON.stringify(initial);
	useEffect(() => onDirty(dirty), [dirty, onDirty]);
	return [form, setForm, dirty] as const;
}
function fieldErrors(error: unknown): Record<string, string> {
	return error instanceof z.ZodError
		? Object.fromEntries(error.issues.map((issue) => [issue.path.join("."), issue.message]))
		: {};
}
function focusError(form: HTMLFormElement) {
	requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

export function TransportRouteEditor({
	source,
	kind,
	onDirty,
	onBusy,
	onCancel,
	onSaved,
}: EditorEvents & {
	source: TransportOpsRoute | null;
	kind: TransportOpsRoute["serviceKind"];
	onSaved: (route: TransportOpsRoute) => void;
}) {
	const [form, setForm] = useDraft<TransportOpsRouteCreate>(
		() =>
			source
				? {
						routeId: source.routeId,
						serviceKind: source.serviceKind,
						origin: source.origin,
						destination: source.destination,
						displayOrder: source.displayOrder,
						defaultBoardingPoint: source.defaultBoardingPoint,
						boardingGuide: source.boardingGuide,
						dropOffPoint: source.dropOffPoint,
					}
				: {
						routeId: "",
						serviceKind: kind,
						origin: "",
						destination: "",
						displayOrder: 0,
						defaultBoardingPoint: null,
						boardingGuide: null,
						dropOffPoint: null,
					},
		onDirty,
	);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const save = useMutation({
		mutationFn: (value: TransportOpsRouteCreate) =>
			source ? updateTransportRoute(source.routeId, value) : createTransportRoute(value),
		onSuccess: (result) => onSaved(result.route),
	});
	useEffect(() => onBusy(save.isPending), [save.isPending, onBusy]);
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const result = TransportOpsRouteCreateSchema.safeParse(form);
		if (!result.success) {
			setErrors(fieldErrors(result.error));
			focusError(event.currentTarget);
			return;
		}
		setErrors({});
		save.mutate(result.data);
	};
	return (
		<EditorFrame
			title={source ? "编辑线路" : "新增线路"}
			subtitle={source ? `${source.origin} → ${source.destination}` : ""}
			busy={save.isPending}
			onCancel={onCancel}
			onSubmit={submit}
		>
			<Errors.Provider value={errors}>
				<div className="grid gap-4 sm:grid-cols-2">
					<Text
						name="origin"
						label="起点"
						value={form.origin}
						onChange={(origin) => setForm({ ...form, origin })}
					/>
					<Text
						name="destination"
						label="终点"
						value={form.destination}
						onChange={(destination) => setForm({ ...form, destination })}
					/>
					<Choice
						name="serviceKind"
						label="服务类型"
						value={form.serviceKind}
						options={[
							["commute", "两校区通勤"],
							["subway", "地铁接驳"],
							["special", "临时班次"],
						]}
						onChange={(serviceKind) =>
							setForm({ ...form, serviceKind: serviceKind as TransportOpsRoute["serviceKind"] })
						}
					/>
					<Text
						name="defaultBoardingPoint"
						label="默认乘车点"
						value={form.defaultBoardingPoint ?? ""}
						onChange={(value) => setForm({ ...form, defaultBoardingPoint: value || null })}
					/>
					<Text
						name="dropOffPoint"
						label="下车点"
						value={form.dropOffPoint ?? ""}
						onChange={(value) => setForm({ ...form, dropOffPoint: value || null })}
					/>
				</div>
				<Area
					name="boardingGuide"
					label="乘车指引"
					value={form.boardingGuide ?? ""}
					onChange={(value) => setForm({ ...form, boardingGuide: value || null })}
				/>
				<Disclosure open={!source || errors.routeId || errors.displayOrder ? true : undefined}>
					<DisclosureSummary className="text-muted-foreground">标识与显示顺序</DisclosureSummary>
					<div className="mt-3 grid gap-4 sm:grid-cols-2">
						<Text
							name="routeId"
							label="线路标识"
							readOnly={Boolean(source)}
							value={form.routeId}
							onChange={(routeId) => setForm({ ...form, routeId })}
						/>
						<Text
							name="displayOrder"
							label="显示顺序"
							type="number"
							value={String(form.displayOrder)}
							onChange={(value) => setForm({ ...form, displayOrder: Number(value) })}
						/>
					</div>
				</Disclosure>
				{Object.keys(errors).length > 0 ? (
					<p role="alert" className="text-danger text-sm">
						请检查标出的线路信息。
					</p>
				) : null}
				{save.error ? <InlineError title="线路保存失败" error={save.error} /> : null}
			</Errors.Provider>
		</EditorFrame>
	);
}

interface ItemDraft {
	key: string;
	kind: "fixed" | "interval";
	departureTime: string;
	firstDepartureTime: string;
	lastDepartureTime: string;
	intervalMinutes: string;
	riderType: "all" | "student" | "teacher";
	boardingPoint: string;
	capacity: string;
	note: string;
}
interface PeriodDraft {
	routeId: string;
	validFrom: string;
	validTo: string;
	weekdays: number[];
	status: "operating" | "suspended";
	boardingPointOverride: string;
	dropOffPointOverride: string;
	note: string;
	items: ItemDraft[];
}
let nextKey = 0;
function newItem(): ItemDraft {
	return {
		key: `new-${nextKey++}`,
		kind: "fixed",
		departureTime: "",
		firstDepartureTime: "",
		lastDepartureTime: "",
		intervalMinutes: "",
		riderType: "all",
		boardingPoint: "",
		capacity: "",
		note: "",
	};
}
function makeDraft(
	source: TransportOpsSchedulePeriod | null,
	routeId: string,
	copy: boolean,
	initial?: TransportOpsSchedulePeriodInput,
): PeriodDraft {
	const seed = initial
		? {
				...initial,
				items: initial.items.map((item, index) => ({ ...item, itemId: `range-${index}` })),
			}
		: source;
	return {
		routeId,
		validFrom: initial?.validFrom ?? (copy ? "" : (source?.validFrom ?? "")),
		validTo: initial ? (initial.validTo ?? "") : copy ? "" : (source?.validTo ?? ""),
		weekdays: seed ? [...seed.weekdays] : [1, 2, 3, 4, 5],
		status: seed?.status ?? "operating",
		boardingPointOverride: seed?.boardingPointOverride ?? "",
		dropOffPointOverride: seed?.dropOffPointOverride ?? "",
		note: seed?.note ?? "",
		items:
			seed?.items.map((item) => ({
				...newItem(),
				key: item.itemId,
				kind: item.kind,
				riderType: item.riderType,
				boardingPoint: item.boardingPoint ?? "",
				note: item.note ?? "",
				capacity: item.capacity === null ? "" : String(item.capacity),
				...(item.kind === "fixed"
					? { departureTime: item.departureTime }
					: {
							firstDepartureTime: item.firstDepartureTime,
							lastDepartureTime: item.lastDepartureTime,
							intervalMinutes: String(item.intervalMinutes),
						}),
			})) ?? [],
	};
}
function periodInput(form: PeriodDraft): TransportOpsSchedulePeriodInput {
	return TransportOpsSchedulePeriodInputSchema.parse({
		...form,
		validTo: form.validTo || null,
		boardingPointOverride: form.boardingPointOverride.trim() || null,
		dropOffPointOverride: form.dropOffPointOverride.trim() || null,
		note: form.note.trim() || null,
		items:
			form.status === "suspended"
				? []
				: form.items.map((item, sortOrder) => ({
						boardingPoint: item.boardingPoint.trim() || null,
						note: item.note.trim() || null,
						capacity: item.capacity.trim() ? Number(item.capacity) : null,
						riderType: item.riderType,
						sortOrder,
						...(item.kind === "fixed"
							? { kind: "fixed", departureTime: item.departureTime }
							: {
									kind: "interval",
									firstDepartureTime: item.firstDepartureTime,
									lastDepartureTime: item.lastDepartureTime,
									intervalMinutes: Number(item.intervalMinutes),
								}),
					})),
	});
}

export function TransportPeriodEditor({
	source,
	copy,
	route,
	onDirty,
	onBusy,
	onCancel,
	onSaved,
	periods = [],
	effectiveDate,
	initial,
	quickAction,
}: EditorEvents & {
	source: TransportOpsSchedulePeriod | null;
	copy: boolean;
	route: TransportOpsRoute;
	onSaved: (period: TransportOpsSchedulePeriod) => void;
	periods?: TransportOpsSchedulePeriod[];
	effectiveDate?: string;
	initial?: TransportOpsSchedulePeriodInput;
	quickAction?: { kind: "add" | "edit" | "cancel"; index: number } | undefined;
}) {
	const [form, setForm, formDirty] = useDraft(
		() => {
			const draft = makeDraft(source, route.routeId, copy, initial);
			if (quickAction?.kind === "add") {
				draft.items.push(newItem());
			}
			return draft;
		},
		() => undefined,
	);
	const [noticeLinks, setNoticeLinks] = useState<TransportNoticeLink[]>([]);
	const hasPreparedChanges = Boolean(initial) || quickAction?.kind === "add";
	useEffect(
		() => onDirty(hasPreparedChanges || formDirty || noticeLinks.length > 0),
		[hasPreparedChanges, formDirty, noticeLinks.length, onDirty],
	);
	const editorBody = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (quickAction && quickAction.kind !== "cancel") {
			const frame = requestAnimationFrame(() => {
				editorBody.current
					?.querySelector<HTMLElement>(
						`fieldset[aria-label="班次 ${quickAction.index + 1}"] input[type="time"]`,
					)
					?.focus();
			});
			return () => cancelAnimationFrame(frame);
		}
		return;
	}, [quickAction]);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [preview, setPreview] = useState<TransportOpsSchedulePeriodInput | null>(null);
	const queryClient = useQueryClient();
	const canSave =
		preview !== null &&
		(copy ||
			!source ||
			JSON.stringify(preview) !==
				JSON.stringify(periodInput(makeDraft(source, route.routeId, false))));
	const save = useMutation({
		mutationFn: (value: TransportOpsSchedulePeriodInput) =>
			source && !copy
				? updateTransportSchedulePeriod(source.scheduleId, value)
				: createTransportSchedulePeriod({
						...value,
						noticeLinks: noticeLinks.map(({ noticeId, summary }) => ({ noticeId, summary })),
					}),
		onSuccess: (result) => {
			if (!source || copy) {
				void queryClient.invalidateQueries({ queryKey: ["notice-transport-periods"] });
			}
			onSaved(result.schedulePeriod);
		},
	});
	useEffect(() => onBusy(save.isPending), [save.isPending, onBusy]);
	const formSnapshot = JSON.stringify([form, noticeLinks]);
	// The snapshot is intentionally the trigger: any draft edit invalidates its preview.
	// biome-ignore lint/correctness/useExhaustiveDependencies: formSnapshot is the intentional trigger.
	useEffect(() => setPreview(null), [formSnapshot]);
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		try {
			const value = periodInput(form);
			setErrors({});
			setPreview(value);
		} catch (error) {
			setErrors(fieldErrors(error));
			focusError(event.currentTarget);
		}
	};
	const inheritedPoint = form.boardingPointOverride || route.defaultBoardingPoint || "未填写";
	return (
		<EditorFrame
			title={
				quickAction
					? "指定日期调整班次"
					: copy
						? "复制为新时间段"
						: source
							? "编辑时间段"
							: "新增时间段"
			}
			subtitle={`${route.origin} → ${route.destination}`}
			busy={save.isPending}
			onCancel={onCancel}
			onSubmit={submit}
			preview={
				preview ? (
					<PeriodPreview
						source={source && !copy ? source : null}
						value={preview}
						route={route}
						periods={periods}
						{...(effectiveDate ? { effectiveDate } : {})}
					/>
				) : null
			}
			onConfirm={preview ? () => save.mutate(preview) : undefined}
			confirmDisabled={!canSave}
		>
			<Errors.Provider value={errors}>
				<div ref={editorBody} className="grid gap-4">
					{quickAction ? (
						<p className="text-sm text-muted-foreground">
							另存为所选日期的完整安排，原安排不变；扩展日期范围会套用整份时刻表。
						</p>
					) : null}
					<div className="grid gap-3 sm:grid-cols-3">
						<Text
							label="开始日期"
							name="validFrom"
							type="date"
							value={form.validFrom}
							onChange={(validFrom) => setForm({ ...form, validFrom })}
						/>
						<Text
							label="结束日期（留空长期）"
							name="validTo"
							type="date"
							value={form.validTo}
							onChange={(validTo) => setForm({ ...form, validTo })}
						/>
						<Choice
							label="状态"
							name="status"
							value={form.status}
							options={[
								["operating", "运行"],
								["suspended", "停运"],
							]}
							onChange={(status) => setForm({ ...form, status: status as PeriodDraft["status"] })}
						/>
					</div>
					<fieldset className="grid gap-2">
						<legend className="mb-2 text-sm font-medium">适用星期</legend>
						<ToggleGroup
							type="multiple"
							presentation="chips"
							aria-label="适用星期"
							className="grid grid-cols-[repeat(auto-fit,minmax(4.125rem,1fr))] sm:grid-cols-7"
							value={form.weekdays.map(String)}
							onValueChange={(values) =>
								setForm({ ...form, weekdays: values.map(Number).sort((a, b) => a - b) })
							}
						>
							{["一", "二", "三", "四", "五", "六", "日"].map((label, index) => (
								<ToggleGroupItem key={label} value={String(index + 1)}>
									周{label}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
						{errors.weekdays ? (
							<p role="alert" className="text-danger text-sm">
								{errors.weekdays}
							</p>
						) : null}
					</fieldset>
					<Disclosure
						open={
							errors.boardingPointOverride || errors.dropOffPointOverride || errors.note
								? true
								: undefined
						}
						className="text-sm"
					>
						<DisclosureSummary className="font-medium">
							上下车点与乘客说明
							{form.boardingPointOverride || form.dropOffPointOverride || form.note
								? " · 已填写"
								: ""}
						</DisclosureSummary>
						<div className="mt-3 grid gap-3 sm:grid-cols-2">
							<Text
								label="本时间段乘车点"
								name="boardingPointOverride"
								placeholder={route.defaultBoardingPoint ?? "留空按班次设置"}
								value={form.boardingPointOverride}
								onChange={(boardingPointOverride) => setForm({ ...form, boardingPointOverride })}
							/>
							<Text
								label="本时间段下车点"
								name="dropOffPointOverride"
								placeholder={route.dropOffPoint ?? "留空沿用线路下车点"}
								value={form.dropOffPointOverride}
								onChange={(dropOffPointOverride) => setForm({ ...form, dropOffPointOverride })}
							/>
							<Area
								label="乘客说明"
								name="note"
								value={form.note}
								onChange={(note) => setForm({ ...form, note })}
							/>
						</div>
					</Disclosure>
					<section aria-label="班次明细" className="grid gap-2">
						<div className="flex items-center justify-between">
							<h3 className="font-medium">
								班次明细{form.status === "operating" ? ` · ${form.items.length} 班` : ""}
							</h3>
							<Button
								disabled={form.status === "suspended"}
								variant="outline"
								size="sm"
								onClick={() => setForm({ ...form, items: [...form.items, newItem()] })}
							>
								添加班次
							</Button>
						</div>
						{form.status === "suspended" ? (
							<p className="py-4 text-sm text-muted-foreground">
								此时间段停运。切回运行可继续编辑本次草稿班次。
							</p>
						) : form.items.length === 0 ? (
							<p className="py-4 text-sm text-muted-foreground">尚未添加班次。</p>
						) : (
							<div className="divide-y rounded-md border px-3">
								{form.items.map((item, index) => (
									<ItemRow
										key={item.key}
										index={index}
										item={item}
										inheritedPoint={inheritedPoint}
										onChange={(next) =>
											setForm({
												...form,
												items: form.items.map((current, i) => (i === index ? next : current)),
											})
										}
										onRemove={() =>
											setForm({ ...form, items: form.items.filter((_, i) => i !== index) })
										}
									/>
								))}
							</div>
						)}
						{errors.items ? (
							<p className="text-danger text-sm" role="alert">
								{errors.items}
							</p>
						) : null}
					</section>
					{Object.keys(errors).length > 0 ? (
						<p role="alert" className="text-danger text-sm">
							请检查标出的日期、星期或班次信息。
						</p>
					) : null}
					{!source || copy ? (
						<TransportNoticePicker
							value={noticeLinks}
							onChange={setNoticeLinks}
							disabled={save.isPending}
						/>
					) : (
						<p className="text-sm text-muted-foreground">
							通知关联保留不变，可在时间段的“关联通知”入口单独修改。
						</p>
					)}
					{save.error ? <InlineError error={save.error} title="时间段保存失败" /> : null}
				</div>
			</Errors.Provider>
		</EditorFrame>
	);
}

function ItemRow({
	item,
	index,
	inheritedPoint,
	onChange,
	onRemove,
}: {
	item: ItemDraft;
	index: number;
	inheritedPoint: string;
	onChange: (value: ItemDraft) => void;
	onRemove: () => void;
}) {
	const errors = useContext(Errors);
	const prefix = `items.${index}.`;
	const extraError = Boolean(errors[`${prefix}capacity`] || errors[`${prefix}note`]);
	return (
		<fieldset className="py-3" aria-label={`班次 ${index + 1}`}>
			<div className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-[6.5rem_7rem_6.5rem_minmax(8rem,1fr)_auto]">
				<Choice
					name={`${prefix}kind`}
					label="模式"
					value={item.kind}
					options={[
						["fixed", "固定时间"],
						["interval", "时间间隔"],
					]}
					onChange={(kind) => onChange({ ...item, kind: kind as ItemDraft["kind"] })}
				/>
				<Text
					name={prefix + (item.kind === "fixed" ? "departureTime" : "firstDepartureTime")}
					label={item.kind === "fixed" ? "发车时间" : "首班时间"}
					type="time"
					value={item.kind === "fixed" ? item.departureTime : item.firstDepartureTime}
					onChange={(value) =>
						onChange({
							...item,
							...(item.kind === "fixed" ? { departureTime: value } : { firstDepartureTime: value }),
						})
					}
				/>
				<Choice
					name={`${prefix}riderType`}
					label="乘车人群"
					value={item.riderType}
					options={[
						["all", "全体师生"],
						["student", "学生"],
						["teacher", "教师"],
					]}
					onChange={(riderType) =>
						onChange({ ...item, riderType: riderType as ItemDraft["riderType"] })
					}
				/>
				<Text
					name={`${prefix}boardingPoint`}
					label="乘车点"
					value={item.boardingPoint}
					placeholder={`沿用：${inheritedPoint}`}
					onChange={(boardingPoint) => onChange({ ...item, boardingPoint })}
				/>
				<div className="flex gap-1">
					<Button size="sm" variant="ghost" aria-label={`删除班次 ${index + 1}`} onClick={onRemove}>
						删除
					</Button>
				</div>
			</div>
			{item.kind === "interval" ? (
				<div className="mt-2 grid gap-2 sm:grid-cols-2">
					<Text
						label="末班时间"
						name={`${prefix}lastDepartureTime`}
						type="time"
						value={item.lastDepartureTime}
						onChange={(lastDepartureTime) => onChange({ ...item, lastDepartureTime })}
					/>
					<Text
						label="间隔分钟"
						name={`${prefix}intervalMinutes`}
						type="number"
						value={item.intervalMinutes}
						onChange={(intervalMinutes) => onChange({ ...item, intervalMinutes })}
					/>
				</div>
			) : null}
			<Disclosure open={extraError ? true : undefined} className="mt-3">
				<DisclosureSummary>更多{item.capacity || item.note ? " · 已填写" : ""}</DisclosureSummary>
				<div className="mt-3 grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
					<Text
						label="容量（可空）"
						name={`${prefix}capacity`}
						type="number"
						value={item.capacity}
						onChange={(capacity) => onChange({ ...item, capacity })}
					/>
					<Area
						label="班次备注"
						name={`${prefix}note`}
						value={item.note}
						onChange={(note) => onChange({ ...item, note })}
					/>
				</div>
			</Disclosure>
		</fieldset>
	);
}

function EditorFrame({
	title,
	subtitle,
	children,
	busy,
	onCancel,
	onSubmit,
	preview,
	onConfirm,
	confirmDisabled = false,
}: {
	title: string;
	subtitle: string;
	children: ReactNode;
	busy: boolean;
	onCancel: () => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	preview?: ReactNode;
	onConfirm?: (() => void) | undefined;
	confirmDisabled?: boolean;
}) {
	const previewRef = useRef<HTMLDivElement>(null);
	const hasPreview = Boolean(preview);
	useEffect(() => {
		if (hasPreview) {
			previewRef.current?.scrollIntoView({ block: "nearest" });
		}
	}, [hasPreview]);
	return (
		<form
			noValidate
			onSubmit={onSubmit}
			className="flex max-h-[calc(100dvh-7rem)] min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-xl)] border bg-background"
			aria-label={title}
		>
			<header className="shrink-0 border-b p-4">
				<h2 className="text-lg font-semibold">{title}</h2>
				{subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
			</header>
			<div className="min-h-0 overflow-y-auto">
				<fieldset disabled={busy} className="grid min-w-0 gap-4 p-4">
					{children}
					{preview ? <div ref={previewRef}>{preview}</div> : null}
				</fieldset>
			</div>
			<footer className="grid shrink-0 grid-cols-2 gap-2 border-t bg-background p-3 sm:flex sm:items-center sm:justify-end">
				<Button disabled={busy} variant="ghost" className="sm:mr-auto" onClick={onCancel}>
					取消
				</Button>
				<Button
					disabled={busy}
					aria-busy={busy && !onConfirm}
					variant={onConfirm ? "secondary" : "primary"}
					type="submit"
				>
					{busy && !onConfirm ? "保存中…" : preview ? "更新预览" : "预览保存"}
				</Button>
				{onConfirm ? (
					<Button
						className="col-span-2 min-w-32"
						disabled={busy || confirmDisabled}
						aria-busy={busy}
						type="button"
						onClick={onConfirm}
					>
						{busy ? "保存中…" : "确认保存"}
					</Button>
				) : null}
			</footer>
		</form>
	);
}

function PeriodPreview({
	source,
	value,
	route,
	periods,
	effectiveDate,
}: {
	source: TransportOpsSchedulePeriod | null;
	value: TransportOpsSchedulePeriodInput;
	route: TransportOpsRoute;
	periods: TransportOpsSchedulePeriod[];
	effectiveDate?: string;
}) {
	const before = source
		? {
				status: source.status,
				validFrom: source.validFrom,
				validTo: source.validTo,
				weekdays: source.weekdays,
				boardingPointOverride: source.boardingPointOverride,
				dropOffPointOverride: source.dropOffPointOverride,
				note: source.note,
				items: source.items,
			}
		: null;
	const changes = [
		before && before.dropOffPointOverride !== value.dropOffPointOverride
			? `时间段下车点：${before.dropOffPointOverride ?? "沿用线路"} → ${value.dropOffPointOverride ?? "沿用线路"}`
			: null,
		before && before.validFrom !== value.validFrom
			? `开始日期：${before.validFrom} → ${value.validFrom}`
			: null,
		before && before.validTo !== value.validTo
			? `结束日期：${before.validTo ?? "长期"} → ${value.validTo ?? "长期"}`
			: null,
		before && JSON.stringify(before.weekdays) !== JSON.stringify(value.weekdays)
			? `适用星期：${formatWeekdays(before.weekdays)} → ${formatWeekdays(value.weekdays)}`
			: null,
		before && before.status !== value.status
			? `状态：${before.status === "operating" ? "运行" : "停运"} → ${value.status === "operating" ? "运行" : "停运"}`
			: null,
		before && before.boardingPointOverride !== value.boardingPointOverride
			? `时间段乘车点：${before.boardingPointOverride ?? "沿用线路/班次"} → ${value.boardingPointOverride ?? "沿用线路/班次"}`
			: null,
		before && before.note !== value.note
			? `乘客说明：${before.note ?? "无"} → ${value.note ?? "无"}`
			: null,
	].filter((change): change is string => Boolean(change));
	return (
		<section
			aria-label="保存前变更预览"
			className="grid gap-2 rounded-md border bg-surface-muted p-3 text-sm"
		>
			<h3 className="font-medium">保存前变更预览</h3>
			<p>{source ? "更新当前时间段" : "新增时间段，保留原安排"}</p>
			<p>
				{route.origin} → {route.destination} · {value.validFrom} — {value.validTo ?? "长期"} ·{" "}
				{formatWeekdays(value.weekdays)}
			</p>
			{changes.length > 0 ? (
				<ul className="grid gap-1">
					{changes.map((change) => (
						<li key={change}>{change}</li>
					))}
				</ul>
			) : null}
			<TransportImpact
				source={source}
				value={value}
				route={route}
				periods={periods}
				{...(effectiveDate ? { effectiveDate } : {})}
			/>
		</section>
	);
}

interface TextProps {
	name: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	type?: string;
	readOnly?: boolean;
	placeholder?: string;
}
function Text({
	name,
	label,
	value,
	onChange,
	type = "text",
	readOnly = false,
	placeholder,
}: TextProps) {
	const errors = useContext(Errors);
	return (
		<Field label={label} error={errors[name]}>
			<Input
				name={name}
				value={value}
				type={type}
				readOnly={readOnly}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
			/>
		</Field>
	);
}
function Area({ name, label, value, onChange }: TextProps) {
	const errors = useContext(Errors);
	return (
		<Field label={label} error={errors[name]}>
			<Textarea name={name} value={value} onChange={(event) => onChange(event.target.value)} />
		</Field>
	);
}
function Choice({
	name,
	label,
	value,
	onChange,
	options,
}: TextProps & { options: [string, string][] }) {
	const errors = useContext(Errors);
	// NativeSelect has a wrapper, so link the label directly to its select.
	const id = useId();
	return (
		<div className="grid min-w-0 gap-1.5 text-sm">
			<label htmlFor={id} className="font-medium">
				{label}
			</label>
			<NativeSelect
				id={id}
				name={name}
				aria-invalid={Boolean(errors[name])}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			>
				{options.map(([key, text]) => (
					<option key={key} value={key}>
						{text}
					</option>
				))}
			</NativeSelect>
			{errors[name] ? <p className="text-danger text-xs">{errors[name]}</p> : null}
		</div>
	);
}
