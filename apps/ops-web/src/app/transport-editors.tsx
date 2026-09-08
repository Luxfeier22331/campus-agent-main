import { Button, Field, Input, NativeSelect, Textarea } from "@campus-agent/ui";
import { useMutation } from "@tanstack/react-query";
import {
	createContext,
	type FormEvent,
	type ReactNode,
	useContext,
	useEffect,
	useId,
	useState,
} from "react";
import { z } from "zod";
import {
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
	return [form, setForm] as const;
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
				<details open={!source || errors.routeId || errors.displayOrder ? true : undefined}>
					<summary className="cursor-pointer text-sm text-muted-foreground">标识与显示顺序</summary>
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
				</details>
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
): PeriodDraft {
	return {
		routeId,
		validFrom: copy ? "" : (source?.validFrom ?? ""),
		validTo: copy ? "" : (source?.validTo ?? ""),
		weekdays: source ? [...source.weekdays] : [1, 2, 3, 4, 5],
		status: source?.status ?? "operating",
		boardingPointOverride: source?.boardingPointOverride ?? "",
		note: source?.note ?? "",
		items:
			source?.items.map((item) => ({
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
}: EditorEvents & {
	source: TransportOpsSchedulePeriod | null;
	copy: boolean;
	route: TransportOpsRoute;
	onSaved: () => void;
}) {
	const [form, setForm] = useDraft(() => makeDraft(source, route.routeId, copy), onDirty);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const save = useMutation({
		mutationFn: (value: TransportOpsSchedulePeriodInput) =>
			source && !copy
				? updateTransportSchedulePeriod(source.scheduleId, value)
				: createTransportSchedulePeriod(value),
		onSuccess: onSaved,
	});
	useEffect(() => onBusy(save.isPending), [save.isPending, onBusy]);
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		try {
			const value = periodInput(form);
			setErrors({});
			save.mutate(value);
		} catch (error) {
			setErrors(fieldErrors(error));
			focusError(event.currentTarget);
		}
	};
	const inheritedPoint = form.boardingPointOverride || route.defaultBoardingPoint || "未填写";
	return (
		<EditorFrame
			title={copy ? "复制为新时间段" : source ? "编辑时间段" : "新增时间段"}
			subtitle={`${route.origin} → ${route.destination}`}
			busy={save.isPending}
			onCancel={onCancel}
			onSubmit={submit}
		>
			<Errors.Provider value={errors}>
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
					<div className="flex flex-wrap gap-1.5">
						{["一", "二", "三", "四", "五", "六", "日"].map((label, index) => {
							const day = index + 1;
							const checked = form.weekdays.includes(day);
							return (
								<Button
									key={day}
									variant={checked ? "secondary" : "outline"}
									aria-pressed={checked}
									onClick={() =>
										setForm({
											...form,
											weekdays: checked
												? form.weekdays.filter((value) => value !== day)
												: [...form.weekdays, day].sort(),
										})
									}
								>
									周{label}
								</Button>
							);
						})}
					</div>
					{errors.weekdays ? (
						<p role="alert" className="text-danger text-sm">
							{errors.weekdays}
						</p>
					) : null}
				</fieldset>
				<details
					open={errors.boardingPointOverride || errors.note ? true : undefined}
					className="text-sm"
				>
					<summary className="cursor-pointer py-1">
						乘车点与备注{form.boardingPointOverride || form.note ? " · 已填写" : ""}
					</summary>
					<div className="mt-3 grid gap-3 sm:grid-cols-2">
						<Text
							label="本时间段乘车点"
							name="boardingPointOverride"
							placeholder={route.defaultBoardingPoint ?? "留空按班次设置"}
							value={form.boardingPointOverride}
							onChange={(boardingPointOverride) => setForm({ ...form, boardingPointOverride })}
						/>
						<Area
							label="备注"
							name="note"
							value={form.note}
							onChange={(note) => setForm({ ...form, note })}
						/>
					</div>
				</details>
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
				{save.error ? <InlineError error={save.error} title="时间段保存失败" /> : null}
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
	const [expanded, setExpanded] = useState(false);
	const prefix = `items.${index}.`;
	const extraError = Boolean(errors[`${prefix}capacity`] || errors[`${prefix}note`]);
	const more = expanded || extraError;
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
					<Button
						size="sm"
						variant="ghost"
						aria-expanded={more}
						onClick={() => setExpanded(!expanded)}
					>
						更多{item.capacity || item.note ? " ·" : ""}
					</Button>
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
			{more ? (
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
			) : null}
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
}: {
	title: string;
	subtitle: string;
	children: ReactNode;
	busy: boolean;
	onCancel: () => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
	return (
		<form
			noValidate
			onSubmit={onSubmit}
			className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col rounded-md border bg-background"
			aria-label={title}
		>
			<header className="shrink-0 border-b p-4">
				<h2 className="text-lg font-semibold">{title}</h2>
				{subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
			</header>
			<fieldset disabled={busy} className="grid min-h-0 gap-4 overflow-y-auto p-4">
				{children}
			</fieldset>
			<footer className="flex shrink-0 justify-end gap-2 border-t bg-background p-3">
				<Button disabled={busy} variant="outline" onClick={onCancel}>
					取消
				</Button>
				<Button disabled={busy} type="submit">
					{busy ? "保存中…" : "保存"}
				</Button>
			</footer>
		</form>
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
