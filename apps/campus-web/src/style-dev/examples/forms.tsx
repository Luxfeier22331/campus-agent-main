import {
	ActionGroup,
	Alert,
	AlertDescription,
	AlertTitle,
	Badge,
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	Checkbox,
	Disclosure,
	DisclosureSummary,
	Field,
	FieldGroup,
	Input,
	NativeSelect,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	Textarea,
	ToggleGroup,
	ToggleGroupItem,
} from "@campus-agent/ui";
import { MoreHorizontalIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { CampusDatePicker, CampusDateRangePicker } from "../../components/ui/date-picker";
import type { StyleDevStory } from "../contracts";

function ButtonsExample({ disabled = false }: { disabled?: boolean }) {
	return (
		<div className="mx-auto grid max-w-2xl gap-5">
			<div className="flex flex-wrap items-center gap-3">
				{(["primary", "secondary", "outline", "ghost", "destructive", "link"] as const).map(
					(variant, index) => (
						<Button key={variant} disabled={disabled} variant={variant}>
							{["保存设置", "更新预览", "导出", "取消", "删除", "了解详情"][index]}
						</Button>
					),
				)}
			</div>
			<ActionGroup>
				<Button disabled={disabled} size="sm" variant="secondary">
					编辑
				</Button>
				<Button disabled={disabled}>
					<SearchIcon aria-hidden />
					搜索
				</Button>
				<Button disabled={disabled} size="lg">
					<SearchIcon aria-hidden />
					搜索校园资料
				</Button>
				<Button aria-label="更多操作" disabled={disabled} size="icon" variant="ghost">
					<MoreHorizontalIcon aria-hidden />
				</Button>
				<Button aria-label="更多设置" disabled={disabled} size="icon-lg" variant="secondary">
					<MoreHorizontalIcon aria-hidden />
				</Button>
			</ActionGroup>
			<Button asChild variant="link" className="w-fit">
				<a href="#style-dev-fields">查看表单示例</a>
			</Button>
		</div>
	);
}

function SavingButtonExample() {
	const [busy, setBusy] = useState(false);
	return (
		<ActionGroup className="mx-auto max-w-2xl">
			<Button className="min-w-32" disabled={busy} aria-busy={busy} onClick={() => setBusy(true)}>
				{busy ? "保存中…" : "确认保存"}
			</Button>
			<Button variant="ghost" onClick={() => setBusy(false)}>
				重置示例
			</Button>
		</ActionGroup>
	);
}

function BadgesExample() {
	return (
		<div className="mx-auto flex max-w-2xl flex-wrap gap-2">
			<Badge tone="neutral">中性</Badge>
			<Badge tone="info">信息</Badge>
			<Badge tone="success">已完成</Badge>
			<Badge tone="warning">需要确认</Badge>
			<Badge tone="danger">失败</Badge>
		</div>
	);
}

function FieldsExample({
	filled,
	invalid,
	disabled = false,
}: {
	filled: boolean;
	invalid: boolean;
	disabled?: boolean;
}) {
	return (
		<div className="mx-auto w-full max-w-2xl">
			<fieldset disabled={disabled}>
				<FieldGroup>
					<Field
						description="用于在校园资料中定位更准确的答案。"
						error={invalid ? "请输入至少 2 个字。" : undefined}
						label="搜索校园资料"
					>
						<Input
							aria-invalid={invalid || undefined}
							defaultValue={filled ? "图书馆开放时间" : undefined}
							placeholder="例如：东区图书馆几点关门？"
						/>
					</Field>
					<Field label="范围">
						<NativeSelect defaultValue="all">
							<option value="all">全部校园资料</option>
							<option value="library">图书馆</option>
							<option value="dining">食堂</option>
						</NativeSelect>
					</Field>
					<Field label="备注" error={invalid ? "请检查备注内容。" : undefined}>
						<Textarea
							placeholder="填写乘车说明"
							defaultValue={filled ? "请提前到乘车点候车。" : undefined}
						/>
					</Field>
					<Field label="只读标识">
						<Input readOnly value="route:haidian-to-fengtai" />
					</Field>
					<div className="grid gap-1.5">
						<label htmlFor="style-dev-select">自定义下拉</label>
						<Select defaultValue="student" disabled={disabled}>
							<SelectTrigger id="style-dev-select">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="student">学生</SelectItem>
								<SelectItem value="teacher">教师</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</FieldGroup>
			</fieldset>
			<div className="mt-5 flex flex-wrap items-center gap-3">
				<label className="flex min-h-11 items-center gap-2 text-sm" htmlFor="style-dev-source-only">
					<Checkbox defaultChecked={filled} id="style-dev-source-only" />
					只看有来源的内容
				</label>
				<Button variant="primary">
					<SearchIcon aria-hidden />
					搜索
				</Button>
			</div>
		</div>
	);
}

function FiltersExample({ disabled = false }: { disabled?: boolean }) {
	const [value, setValue] = useState("all");
	const [days, setDays] = useState(["1", "2", "3", "4", "5"]);
	return (
		<div className="mx-auto grid max-w-2xl gap-4">
			<ToggleGroup
				disabled={disabled}
				type="single"
				presentation="segmented"
				value={value}
				onValueChange={(next) => next && setValue(next)}
				aria-label="人群筛选"
				className="w-fit"
			>
				<ToggleGroupItem value="all">全部</ToggleGroupItem>
				<ToggleGroupItem value="student">学生</ToggleGroupItem>
				<ToggleGroupItem value="teacher">教师</ToggleGroupItem>
			</ToggleGroup>
			<ToggleGroup
				disabled={disabled}
				type="multiple"
				presentation="chips"
				value={days}
				onValueChange={setDays}
				aria-label="适用星期"
				className="grid grid-cols-[repeat(auto-fit,minmax(4.125rem,1fr))] sm:grid-cols-7"
			>
				{["一", "二", "三", "四", "五", "六", "日"].map((label, index) => (
					<ToggleGroupItem key={label} value={String(index + 1)}>
						周{label}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</div>
	);
}
function DatesExample() {
	const [date, setDate] = useState("2026-09-11");
	const [range, setRange] = useState<{ from: string | undefined; to: string | undefined }>({
		from: undefined,
		to: undefined,
	});
	return (
		<div className="mx-auto grid max-w-2xl gap-4">
			<CampusDatePicker value={date} onChange={setDate} ariaLabel="选择日期" />
			<CampusDateRangePicker {...range} onApply={setRange} />
			<Field label="原生时间">
				<Input type="time" defaultValue="08:10" />
			</Field>
		</div>
	);
}
function DisclosureExample() {
	return (
		<div className="mx-auto grid max-w-2xl gap-3">
			<Disclosure className="rounded-[var(--radius-lg)] border p-3">
				<DisclosureSummary>乘车指引与一段较长的说明标题，窄屏允许自然换行</DisclosureSummary>
				<p className="pt-3 text-sm">请提前到乘车点候车。</p>
			</Disclosure>
			<Disclosure open className="rounded-[var(--radius-lg)] border p-3">
				<DisclosureSummary>默认展开</DisclosureSummary>
				<p className="pt-3 text-sm">内容保持原生折叠行为。</p>
			</Disclosure>
		</div>
	);
}
function SelectionExample({
	presentation = "underline",
}: {
	presentation?: "underline" | "segmented";
}) {
	const [value, setValue] = useState("overview");
	return (
		<div className="mx-auto w-full max-w-2xl">
			<Tabs onValueChange={setValue} value={value}>
				<TabsList aria-label="内容范围" presentation={presentation}>
					<TabsTrigger value="overview">概览</TabsTrigger>
					<TabsTrigger value="sources">来源</TabsTrigger>
				</TabsList>
				<TabsContent value="overview">
					<p>回答内容、来源和时间信息各自保持清晰层级。</p>
				</TabsContent>
				<TabsContent value="sources">
					<p>来源列表只在有真实来源时出现。</p>
				</TabsContent>
			</Tabs>
		</div>
	);
}

function CheckboxStatesExample() {
	return (
		<div className="mx-auto grid max-w-2xl gap-2">
			{(
				[
					{ id: "unchecked", label: "未选择" },
					{ id: "checked", label: "已选择", checked: true },
					{ id: "mixed", label: "部分选择", checked: "indeterminate" },
					{ id: "disabled", label: "不可修改", checked: true, disabled: true },
					{ id: "invalid", label: "请选择此项", invalid: true },
					{
						id: "long",
						label: "这是一段较长的选项说明，在窄屏下允许换行，点击整段文字也可以选择。",
					},
				] as const
			).map((state) => (
				<label
					key={state.id}
					htmlFor={`checkbox-${state.id}`}
					className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"
				>
					<Checkbox
						id={`checkbox-${state.id}`}
						defaultChecked={"checked" in state ? state.checked : false}
						disabled={"disabled" in state && state.disabled}
						aria-invalid={"invalid" in state ? state.invalid : undefined}
					/>
					<span>{state.label}</span>
				</label>
			))}
		</div>
	);
}

function StatusSurfacesExample() {
	return (
		<Card className="mx-auto max-w-2xl">
			<CardHeader>
				<CardTitle>排班状态</CardTitle>
			</CardHeader>
			<CardContent className="grid gap-3">
				{(["info", "success", "warning", "danger"] as const).map((tone) => (
					<Alert key={tone} tone={tone}>
						<AlertTitle>
							{
								{
									info: "乘车提醒",
									success: "保存成功",
									warning: "请检查日期",
									danger: "保存失败",
								}[tone]
							}
						</AlertTitle>
						<AlertDescription>
							班次的详细说明使用正文颜色，状态通过标题和边界区分。
						</AlertDescription>
					</Alert>
				))}
			</CardContent>
		</Card>
	);
}

export const FORM_ENTRIES: readonly StyleDevStory[] = [
	{
		id: "style-dev-checkboxes",
		title: "复选框",
		group: "表单与控件",
		defaultVariant: "states",
		variants: [{ id: "states", label: "状态", render: () => <CheckboxStatesExample /> }],
	},
	{
		id: "style-dev-status-surfaces",
		title: "卡片与提示",
		group: "表单与控件",
		defaultVariant: "states",
		variants: [{ id: "states", label: "状态", render: () => <StatusSurfacesExample /> }],
	},
	{
		id: "style-dev-filters",
		title: "分段与多选",
		group: "表单与控件",
		defaultVariant: "default",
		variants: [
			{ id: "default", label: "默认", render: () => <FiltersExample /> },
			{ id: "disabled", label: "禁用", render: () => <FiltersExample disabled /> },
		],
	},
	{
		id: "style-dev-dates",
		title: "日期与时间",
		group: "表单与控件",
		defaultVariant: "default",
		variants: [{ id: "default", label: "默认", render: () => <DatesExample /> }],
	},
	{
		id: "style-dev-disclosure",
		title: "折叠说明",
		group: "表单与控件",
		defaultVariant: "default",
		variants: [{ id: "default", label: "默认", render: () => <DisclosureExample /> }],
	},
	{
		defaultVariant: "default",
		variants: [
			{ id: "default", label: "默认", render: () => <ButtonsExample /> },
			{ id: "disabled", label: "禁用", render: () => <ButtonsExample disabled /> },
			{ id: "saving", label: "保存中", render: () => <SavingButtonExample /> },
		],
		group: "表单与控件",
		id: "style-dev-buttons",
		title: "按钮",
	},
	{
		defaultVariant: "badges",
		variants: [{ id: "badges", label: "状态标签", render: () => <BadgesExample /> }],
		group: "表单与控件",
		id: "style-dev-badges",
		title: "状态标签",
	},
	{
		defaultVariant: "empty",
		variants: [
			{
				id: "empty",
				label: "空字段",
				render: () => <FieldsExample filled={false} invalid={false} />,
			},
			{ id: "filled", label: "已填写", render: () => <FieldsExample filled invalid={false} /> },
			{ id: "invalid", label: "字段错误", render: () => <FieldsExample filled invalid /> },
			{
				id: "disabled",
				label: "禁用",
				render: () => <FieldsExample filled invalid={false} disabled />,
			},
		],
		group: "表单与控件",
		id: "style-dev-fields",
		title: "字段与校验",
	},
	{
		defaultVariant: "tabs",
		variants: [
			{ id: "tabs", label: "下划线", render: () => <SelectionExample /> },
			{
				id: "segmented",
				label: "分段",
				render: () => <SelectionExample presentation="segmented" />,
			},
		],
		group: "表单与控件",
		id: "style-dev-selection",
		title: "选择与切换",
	},
];
