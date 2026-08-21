import {
	Badge,
	Button,
	Checkbox,
	Field,
	FieldGroup,
	Input,
	NativeSelect,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@campus-agent/ui";
import { MoreHorizontalIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import type { StyleDevStory } from "../contracts";

function ButtonsExample({ disabled = false }: { disabled?: boolean }) {
	return (
		<div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2">
			<Button disabled={disabled} variant="primary">
				保存设置
			</Button>
			<Button disabled={disabled} variant="outline">
				取消
			</Button>
			<Button aria-label="更多操作" disabled={disabled} size="icon" variant="ghost">
				<MoreHorizontalIcon aria-hidden />
			</Button>
		</div>
	);
}

function BadgesExample() {
	return (
		<div className="mx-auto flex max-w-2xl flex-wrap gap-2">
			<Badge tone="neutral">中性</Badge>
			<Badge tone="info">信息</Badge>
			<Badge tone="warning">需要确认</Badge>
			<Badge tone="danger">失败</Badge>
		</div>
	);
}

function FieldsExample({ filled, invalid }: { filled: boolean; invalid: boolean }) {
	return (
		<div className="mx-auto w-full max-w-2xl">
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
			</FieldGroup>
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

function SelectionExample() {
	const [value, setValue] = useState("overview");
	return (
		<div className="mx-auto w-full max-w-2xl">
			<Tabs onValueChange={setValue} value={value}>
				<TabsList aria-label="内容范围">
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

export const FORM_ENTRIES: readonly StyleDevStory[] = [
	{
		defaultVariant: "default",
		variants: [
			{ id: "default", label: "默认", render: () => <ButtonsExample /> },
			{ id: "disabled", label: "禁用", render: () => <ButtonsExample disabled /> },
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
		],
		group: "表单与控件",
		id: "style-dev-fields",
		title: "字段与校验",
	},
	{
		defaultVariant: "tabs",
		variants: [{ id: "tabs", label: "Tabs", render: () => <SelectionExample /> }],
		group: "表单与控件",
		id: "style-dev-selection",
		title: "选择与切换",
	},
];
