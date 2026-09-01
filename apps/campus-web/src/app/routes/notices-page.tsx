import { Button, Input, Label } from "@campus-agent/ui";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type {
	NoticeFilterCategory,
	NoticeListRequestQuery,
	NoticeStream,
} from "campus-contracts/notices";
import { Search, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { StateMessage } from "@/components/ui/state-message";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { noticeListQueryOptions } from "@/features/notices/queries";
import { noticeQueryClient } from "@/features/notices/query-client";
import { DateRangeFilter, FilterSelect } from "./notices-filters";
import { NoticeListSkeleton } from "./notices-list-skeleton";
import { NoticeResults } from "./notices-results";

export function NoticesPage() {
	return (
		<QueryClientProvider client={noticeQueryClient}>
			<NoticesPageContent />
		</QueryClientProvider>
	);
}

export function NoticesPageContent() {
	const navigate = useNavigate({ from: "/notices" });
	const search = useSearch({ from: "/notices" });
	const notices = useQuery(noticeListQueryOptions(search));
	const [queryDraft, setQueryDraft] = useState(search.q ?? "");
	useEffect(() => setQueryDraft(search.q ?? ""), [search.q]);

	function updateSearch(patch: Partial<NoticeListRequestQuery>, resetPage = true): void {
		void navigate({
			search: (previous) => ({
				...previous,
				...patch,
				page: resetPage ? 1 : (patch.page ?? previous.page),
			}),
		});
	}

	function submitSearch(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		updateSearch({ q: queryDraft.trim() || undefined });
	}

	function updateStream(stream: NoticeStream): void {
		void navigate({
			search: (previous) => ({
				...previous,
				category: undefined,
				page: 1,
				stream,
			}),
		});
	}

	const hasFilters = Boolean(
		search.q ||
			search.category ||
			search.organization_id ||
			search.notice_type ||
			search.is_external !== undefined ||
			search.from ||
			search.to,
	);
	const isCampusNews = search.stream === "campus_news";
	const itemLabel = isCampusNews ? "校园动态" : "通知";

	return (
		<section className="mx-auto w-full max-w-[var(--layout-page-form-width)] px-4 pb-20 pt-7 sm:px-6 sm:pt-9">
			<header>
				<div className="flex min-w-0 flex-wrap items-start justify-between gap-3 sm:flex-nowrap sm:gap-4">
					<div className="min-w-0">
						<h1 className="text-2xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
							{isCampusNews ? "校园动态" : "通知目录"}
						</h1>
						<p className="mt-1 text-sm text-[var(--sys-text-muted)]">
							{notices.data
								? `${notices.data.pagination.totalItems} 条${itemLabel}`
								: `正在读取${itemLabel}`}
						</p>
					</div>
					<ToggleGroup
						aria-label="通知视图"
						className="shrink-0 rounded-lg bg-surface-muted p-1"
						onValueChange={(value) => {
							if (value === "notices" || value === "campus_news") {
								updateStream(value);
							}
						}}
						size="sm"
						type="single"
						value={search.stream}
					>
						<ToggleGroupItem
							className="min-w-16 rounded-md px-3 data-[state=on]:bg-background data-[state=on]:shadow-[var(--shadow-xs)] sm:min-w-20"
							value="notices"
						>
							通知
						</ToggleGroupItem>
						<ToggleGroupItem
							className="min-w-20 rounded-md px-3 data-[state=on]:bg-background data-[state=on]:shadow-[var(--shadow-xs)]"
							value="campus_news"
						>
							校园动态
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
			</header>

			<form aria-label={`${itemLabel}筛选`} className="mt-6" onSubmit={submitSearch}>
				<Label className="sr-only" htmlFor="notice-search">
					标题或正文关键词
				</Label>
				<div className="relative rounded-xl border border-input bg-background shadow-[var(--shadow-xs)] transition-shadow focus-within:ring-2 focus-within:ring-ring">
					<Search
						aria-hidden="true"
						className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-[var(--sys-text-muted)]"
					/>
					<Input
						className="min-h-12 rounded-xl border-0 bg-transparent pl-11 pr-12 shadow-none focus-visible:ring-0"
						id="notice-search"
						maxLength={100}
						onChange={(event) => setQueryDraft(event.target.value)}
						placeholder={`搜索${itemLabel}`}
						value={queryDraft}
					/>
					<Button
						aria-label={`搜索${itemLabel}`}
						className="absolute right-0.5 top-1/2 size-11 min-h-0 -translate-y-1/2 rounded-[10px] p-0"
						size="icon"
						type="submit"
					>
						<Search />
					</Button>
				</div>
				<div className="mt-3 flex min-h-9 flex-wrap items-center gap-2">
					{isCampusNews ? null : (
						<FilterSelect
							id="notice-category"
							label="业务分类"
							onChange={(value) =>
								updateSearch({ category: value as NoticeFilterCategory | undefined })
							}
							options={(notices.data?.filters.categories ?? []).map((option) => ({
								label: option.label,
								value: option.value,
							}))}
							value={search.category}
						/>
					)}
					<DateRangeFilter
						from={search.from}
						onClear={() => updateSearch({ from: undefined, to: undefined })}
						onFromChange={(value) => updateSearch({ from: value })}
						onToChange={(value) => updateSearch({ to: value })}
						to={search.to}
					/>
					{hasFilters ? (
						<Button
							aria-label="清除筛选"
							className="ml-auto rounded-lg px-2.5 text-[var(--sys-text-muted)]"
							onClick={() => {
								setQueryDraft("");
								void navigate({ search: { page: 1, stream: search.stream } });
							}}
							size="sm"
							variant="ghost"
						>
							<X />
							清除
						</Button>
					) : null}
				</div>
			</form>

			<div className="mt-5 min-h-80 border-t border-border pt-1">
				{notices.isPending ? <NoticeListSkeleton itemLabel={itemLabel} /> : null}
				{notices.isError ? (
					<StateMessage
						className="mt-6"
						description={`${isCampusNews ? "校园动态" : "通知目录"}暂时无法读取，请稍后重试。`}
						layout="section"
						primaryAction={<Button onClick={() => void notices.refetch()}>重试</Button>}
						role="alert"
						title={`${isCampusNews ? "校园动态" : "通知目录"}不可用`}
						tone="danger"
					/>
				) : null}
				{notices.data && notices.data.items.length === 0 ? (
					<StateMessage
						className="mt-2"
						description={
							isCampusNews
								? "调整关键词或日期范围后再试。"
								: "调整关键词、业务分类或日期范围后再试。"
						}
						layout="section"
						title={`没有符合条件的${itemLabel}`}
					/>
				) : null}
				{notices.data && notices.data.items.length > 0 ? (
					<NoticeResults
						data={notices.data}
						itemLabel={itemLabel}
						pending={notices.isPlaceholderData}
					/>
				) : null}
			</div>
		</section>
	);
}
