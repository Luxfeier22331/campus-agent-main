import { Badge, Button, ThemeModeControl, ThemeModeMenu } from "@campus-agent/ui";
import { useEffect, useRef } from "react";
import type { StyleDevStory } from "../contracts";
import { TokenCatalog } from "../token-catalog";

function TypographyExample({ focused = false }: { focused?: boolean }) {
	const focusTargetRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (focused) {
			focusTargetRef.current?.focus();
		}
	}, [focused]);

	return (
		<div className="mx-auto max-w-2xl space-y-5">
			<h1 className="text-3xl font-semibold tracking-tight text-[var(--sys-text-strong)]">
				校园服务
			</h1>
			<h2 className="text-xl font-semibold text-[var(--sys-text-strong)]">图书馆开放时间</h2>
			<p className="max-w-[65ch] text-base leading-7 text-[var(--sys-text-muted)]">
				东区图书馆今天开放至 22:00，节假日安排以当日通知为准。
			</p>
			<time
				className="block text-sm text-[var(--sys-text-subtle)]"
				dateTime="2026-08-20T11:30:00+08:00"
			>
				2026 年 8 月 20 日 11:30
			</time>
			<Button ref={focusTargetRef} type="button" variant="outline">
				键盘焦点
			</Button>
		</div>
	);
}

function ThemeExample() {
	return (
		<div className="mx-auto flex max-w-2xl flex-wrap items-center gap-3">
			<ThemeModeControl aria-label="切换主题" label="主题" />
			<ThemeModeMenu />
			<Badge tone="neutral">中性内容</Badge>
			<Badge tone="info">信息提示</Badge>
			<Button size="sm" variant="primary">
				主操作
			</Button>
		</div>
	);
}

export const FOUNDATION_ENTRIES: readonly StyleDevStory[] = [
	{
		defaultVariant: "values",
		variants: [{ id: "values", label: "当前主题", render: () => <TokenCatalog /> }],
		group: "基础与主题",
		id: "style-dev-tokens",
		title: "语义 Token",
	},
	{
		defaultVariant: "type",
		variants: [
			{ id: "type", label: "排版", render: () => <TypographyExample /> },
			{ id: "focus", label: "焦点", render: () => <TypographyExample focused /> },
		],
		group: "基础与主题",
		id: "style-dev-foundations",
		title: "排版与焦点",
	},
	{
		defaultVariant: "theme",
		variants: [{ id: "theme", label: "主题控制", render: () => <ThemeExample /> }],
		group: "基础与主题",
		id: "style-dev-theme",
		title: "主题控制",
	},
];
