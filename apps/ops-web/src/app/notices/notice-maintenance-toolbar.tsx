import { Button, cn, Field, Input, NativeSelect } from "@campus-agent/ui";
import {
	NOTICE_CATEGORIES,
	NOTICE_CATEGORY_LABELS,
	type NoticeCategory,
} from "campus-contracts/notices";
import { Search } from "lucide-react";
import type { FormEvent } from "react";
import type { NoticeListCounts, NoticeState } from "../../shared/ops-contract";
import { noticeStateLabel } from "./notice-status";

const STATE_OPTIONS: Array<{
	value: NoticeState | "";
	label: string;
	countKey: keyof NoticeListCounts;
}> = [
	{ countKey: "all", label: "全部", value: "" },
	{
		countKey: "needsClassification",
		label: noticeStateLabel("needs_classification"),
		value: "needs_classification",
	},
	{
		countKey: "needsPublication",
		label: noticeStateLabel("needs_publication"),
		value: "needs_publication",
	},
	{ countKey: "published", label: noticeStateLabel("published"), value: "published" },
];

export function NoticeMaintenanceToolbar({
	category,
	counts,
	isFetching,
	isPlaceholderData,
	onCategoryChange,
	onSearch,
	onSearchChange,
	onStateChange,
	q,
	search,
	state,
}: {
	category: NoticeCategory | "";
	counts: NoticeListCounts | null;
	isFetching: boolean;
	isPlaceholderData: boolean;
	onCategoryChange: (category: NoticeCategory | "") => void;
	onSearch: (value: string) => void;
	onSearchChange: (value: string) => void;
	onStateChange: (state: NoticeState | "") => void;
	q: string;
	search: string;
	state: NoticeState | "";
}) {
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		onSearch(search);
	};

	return (
		<div className="mb-5 grid gap-5 border-border border-b pb-5">
			<nav aria-label="通知状态" className="flex max-w-full gap-1 overflow-x-auto">
				{STATE_OPTIONS.map((option) => {
					const active = state === option.value;
					const count = counts?.[option.countKey];
					return (
						<button
							aria-current={active ? "page" : undefined}
							aria-pressed={active}
							className={cn(
								"inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition-[background-color,color] duration-[var(--motion-duration-fast)]",
								active
									? "bg-selected font-semibold text-selected-foreground"
									: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
							)}
							key={option.value || "all"}
							onClick={() => onStateChange(option.value)}
							type="button"
						>
							<span>{option.label}</span>
							<span
								className={cn(
									"font-mono text-xs",
									active ? "text-selected-foreground/75" : "text-muted-foreground",
								)}
							>
								{count ?? "—"}
							</span>
						</button>
					);
				})}
			</nav>

			<form className="grid gap-3 md:grid-cols-[minmax(16rem,1fr)_14rem_auto]" onSubmit={submit}>
				<Field label="搜索标题或通知 ID">
					<div className="relative">
						<Input
							className="pr-11"
							onChange={(event) => onSearchChange(event.target.value)}
							placeholder="输入标题或 ID"
							value={search}
						/>
						<Search
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
						/>
					</div>
				</Field>
				<Field label="分类">
					<NativeSelect
						onChange={(event) => onCategoryChange(event.target.value as NoticeCategory | "")}
						value={category}
					>
						<option value="">全部分类</option>
						{NOTICE_CATEGORIES.map((value) => (
							<option key={value} value={value}>
								{NOTICE_CATEGORY_LABELS[value]}
							</option>
						))}
					</NativeSelect>
				</Field>
				<div className="flex items-end">
					<Button className="w-full md:w-auto" disabled={isPlaceholderData} type="submit">
						<Search className="size-4" />
						搜索
					</Button>
				</div>
			</form>

			<div aria-live="polite" className="min-h-5 text-muted-foreground text-xs">
				{isFetching ? "正在刷新通知队列…" : q ? `当前搜索：${q}` : "按发布时间倒序显示"}
			</div>
		</div>
	);
}
