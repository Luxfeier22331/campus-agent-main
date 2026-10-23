import { Button, Field, Input } from "@campus-agent/ui";
import {
	NOTICE_CATEGORIES,
	NOTICE_CATEGORY_LABELS,
	type NoticeCategory,
} from "campus-contracts/notices";
import { Search } from "lucide-react";
import type { FormEvent } from "react";
import type { NoticeListCounts, NoticeState } from "../../shared/ops-contract";
import { FilterSelect } from "../ui/filter-select";
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
		<div className="mb-4 grid gap-3">
			<form
				className="ops-filter-bar grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_11rem_11rem_auto]"
				onSubmit={submit}
			>
				<Field
					label="搜索标题或通知 ID"
					action={<Search aria-hidden="true" className="pointer-events-none mr-3 size-4" />}
				>
					<Input
						className="pr-11"
						onChange={(event) => onSearchChange(event.target.value)}
						placeholder="输入标题或 ID"
						value={search}
					/>
				</Field>
				<Field label="状态">
					<FilterSelect
						className="min-h-11"
						onValueChange={(nextValue) => onStateChange(nextValue as NoticeState | "")}
						value={state}
						options={STATE_OPTIONS.map((option) => ({
							value: option.value,
							label:
								counts?.[option.countKey] === undefined
									? option.label
									: `${option.label}（${counts[option.countKey]}）`,
						}))}
					/>
				</Field>
				<Field label="分类">
					<FilterSelect
						onValueChange={(nextValue) => onCategoryChange(nextValue as NoticeCategory | "")}
						value={category}
						options={[
							{ value: "", label: "全部分类" },
							...NOTICE_CATEGORIES.map((value) => ({
								value: value,
								label: NOTICE_CATEGORY_LABELS[value],
							})),
						]}
					/>
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
