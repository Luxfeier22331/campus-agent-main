import {
	Button,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Skeleton,
} from "@campus-agent/ui";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type {
	NoticeFilterCategory,
	NoticeListItem,
	NoticeListRequestQuery,
	NoticeListResponse,
	NoticeStream,
} from "campus-contracts/notices";
import {
	ArrowLeft,
	ArrowRight,
	ArrowUpRight,
	CalendarDays,
	ChevronRight,
	FileText,
	Globe2,
	Landmark,
	MessageCircle,
	Newspaper,
	School,
	Search,
	X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StateMessage } from "@/components/ui/state-message";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NoticeCategoryBadge } from "@/features/notices/category-badge";
import {
	describeExternalNoticeSource,
	type ExternalNoticeSourceKind,
} from "@/features/notices/external-source";
import { noticeListQueryOptions } from "@/features/notices/queries";
import { noticeQueryClient } from "@/features/notices/query-client";

const RELEASE_DATE_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
	day: "2-digit",
	hour: "2-digit",
	hourCycle: "h23",
	minute: "2-digit",
	month: "2-digit",
	timeZone: "Asia/Shanghai",
	year: "numeric",
});
const FILTER_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
	day: "numeric",
	month: "long",
	timeZone: "Asia/Shanghai",
	year: "numeric",
});

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

function FilterSelect(props: {
	id: string;
	label: string;
	onChange: (value: string | undefined) => void;
	options: ReadonlyArray<{ label: string; value: string }>;
	value: string | undefined;
}) {
	return (
		<div>
			<Label className="sr-only" htmlFor={props.id}>
				{props.label}
			</Label>
			<Select
				onValueChange={(value) => props.onChange(value === "all" ? undefined : value)}
				value={props.value ?? "all"}
			>
				<SelectTrigger
					aria-label={props.label}
					className="min-h-9 w-auto max-w-56 gap-2 rounded-lg border-border bg-transparent px-3 py-1.5 shadow-none"
					id={props.id}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent align="start">
					<SelectItem value="all">全部分类</SelectItem>
					{props.options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function DateRangeFilter(props: {
	from: string | undefined;
	onClear: () => void;
	onFromChange: (value: string | undefined) => void;
	onToChange: (value: string | undefined) => void;
	to: string | undefined;
}) {
	const label = formatDateRangeLabel(props.from, props.to);
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					aria-label={`发布日期：${label}`}
					className={
						props.from || props.to
							? "max-w-full rounded-lg border-[var(--campus-selected-border)] bg-selected px-3 text-selected-foreground shadow-none"
							: "max-w-full rounded-lg border-border bg-transparent px-3 shadow-none"
					}
					size="sm"
					variant="outline"
				>
					<CalendarDays />
					<span className="truncate">{label}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-[min(22rem,calc(100vw-2rem))] border-border-default bg-surface-raised p-4 shadow-lg"
				sideOffset={8}
			>
				<fieldset className="m-0 border-0 p-0">
					<legend className="text-sm font-medium text-[var(--sys-text-strong)]">发布日期</legend>
					<div className="mt-3 grid gap-3 sm:grid-cols-2">
						<div>
							<Label
								className="mb-1.5 block text-xs text-[var(--sys-text-muted)]"
								htmlFor="notice-from"
							>
								开始
							</Label>
							<Input
								className="min-w-0 tabular-nums"
								id="notice-from"
								max={props.to}
								onChange={(event) => props.onFromChange(event.target.value || undefined)}
								type="date"
								value={props.from ?? ""}
							/>
						</div>
						<div>
							<Label
								className="mb-1.5 block text-xs text-[var(--sys-text-muted)]"
								htmlFor="notice-to"
							>
								结束
							</Label>
							<Input
								className="min-w-0 tabular-nums"
								id="notice-to"
								min={props.from}
								onChange={(event) => props.onToChange(event.target.value || undefined)}
								type="date"
								value={props.to ?? ""}
							/>
						</div>
					</div>
					{props.from || props.to ? (
						<Button
							className="mt-3 px-2 text-[var(--sys-text-muted)]"
							onClick={props.onClear}
							size="sm"
							variant="ghost"
						>
							<X />
							清除日期
						</Button>
					) : null}
				</fieldset>
			</PopoverContent>
		</Popover>
	);
}

function formatDateRangeLabel(from: string | undefined, to: string | undefined): string {
	if (!(from || to)) {
		return "发布日期";
	}
	if (from && to) {
		return `${formatFilterDate(from)} - ${formatFilterDate(to)}`;
	}
	return from ? `${formatFilterDate(from)}起` : `${formatFilterDate(to as string)}前`;
}

function formatFilterDate(value: string): string {
	return FILTER_DATE_FORMATTER.format(new Date(`${value}T00:00:00+08:00`));
}

function NoticeResults({
	data,
	itemLabel,
	pending,
}: {
	data: NoticeListResponse;
	itemLabel: string;
	pending: boolean;
}) {
	const navigate = useNavigate({ from: "/notices" });
	return (
		<div className={pending ? "opacity-60" : undefined}>
			<ul className="space-y-1 py-1" data-testid="notice-list">
				{data.items.map((item) => (
					<li key={item.noticeId}>
						<NoticeRow item={item} />
					</li>
				))}
			</ul>
			<nav
				aria-label={`${itemLabel}分页`}
				className="mt-2 flex min-h-14 items-center justify-between gap-4 border-t border-border"
			>
				<p className="text-sm tabular-nums text-[var(--sys-text-muted)]">
					第 {data.pagination.page} / {data.pagination.totalPages} 页
				</p>
				<div className="flex gap-1">
					<Button
						disabled={pending || data.pagination.page <= 1}
						onClick={() =>
							void navigate({
								search: (previous) => ({ ...previous, page: previous.page - 1 }),
							})
						}
						size="sm"
						variant="ghost"
					>
						<ArrowLeft />
						上一页
					</Button>
					<Button
						disabled={pending || data.pagination.page >= data.pagination.totalPages}
						onClick={() =>
							void navigate({
								search: (previous) => ({ ...previous, page: previous.page + 1 }),
							})
						}
						size="sm"
						variant="ghost"
					>
						下一页
						<ArrowRight />
					</Button>
				</div>
			</nav>
		</div>
	);
}

function NoticeRow({ item }: { item: NoticeListItem }) {
	const externalSource = item.isExternal ? describeExternalNoticeSource(item.externalUrl) : null;
	const source = externalSource
		? {
				...externalSource,
				title: `外链来源：${externalSource.label}（${externalSource.hostname}）`,
			}
		: { kind: "campus" as const, label: "校内门户", title: "通知来源：校内门户" };
	const content = (
		<div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-3 py-3.5">
			<h2 className="min-w-0 break-words text-[15px] font-medium leading-6 tracking-normal text-[var(--sys-text-strong)] group-hover:text-link sm:text-base">
				{item.title}
			</h2>
			<span
				aria-hidden="true"
				className="mt-1 flex size-4 items-center justify-center text-[var(--sys-text-muted)]"
			>
				{item.isExternal ? (
					<ArrowUpRight className="size-4" />
				) : (
					<ChevronRight className="size-4" />
				)}
			</span>
			<div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
				<NoticeCategoryBadge category={item.category} className="font-medium" />
				<time
					className="whitespace-nowrap text-xs tabular-nums text-[var(--sys-text-muted)]"
					dateTime={item.releasedAt}
				>
					{RELEASE_DATE_FORMATTER.format(new Date(item.releasedAt))}
				</time>
				<NoticeMetadata
					organization={item.organization?.name ?? "发布部门未标注"}
					source={source}
					type={item.noticeType.name}
				/>
			</div>
		</div>
	);
	const className =
		"group block rounded-lg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
	if (item.isExternal) {
		return (
			<a className={className} href={item.externalUrl} rel="noopener noreferrer" target="_blank">
				{content}
			</a>
		);
	}
	return (
		<Link className={className} params={{ noticeId: item.noticeId }} to="/notices/$noticeId">
			{content}
		</Link>
	);
}

const NOTICE_SOURCE_ICONS = {
	campus: School,
	document: FileText,
	media: Newspaper,
	procurement: Landmark,
	website: Globe2,
	wechat: MessageCircle,
} as const satisfies Record<ExternalNoticeSourceKind, typeof Globe2>;

function NoticeMetadata({
	organization,
	source,
	type,
}: {
	organization: string;
	source: { kind: ExternalNoticeSourceKind; label: string; title: string };
	type: string;
}) {
	const SourceIcon = NOTICE_SOURCE_ICONS[source.kind];
	return (
		<p className="contents text-xs text-[var(--sys-text-muted)]">
			<span className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={source.title}>
				<span aria-hidden="true" className="text-border">
					·
				</span>
				<SourceIcon aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="truncate">{source.label}</span>
			</span>
			<span className="inline-flex min-w-0 max-w-full items-center gap-2 text-xs text-[var(--sys-text-muted)]">
				<span aria-hidden="true" className="text-border">
					·
				</span>
				<span className="break-words">{organization}</span>
			</span>
			<span className="inline-flex min-w-0 max-w-full items-center gap-2 text-xs text-[var(--sys-text-muted)]">
				<span aria-hidden="true" className="text-border">
					·
				</span>
				<span className="break-words">门户栏目：{type}</span>
			</span>
		</p>
	);
}

function NoticeListSkeleton(props: { itemLabel: string }) {
	const rows = ["first", "second", "third", "fourth", "fifth", "sixth"];
	return (
		<div aria-label={`正在读取${props.itemLabel}`} className="space-y-1 py-1" role="status">
			{rows.map((row) => (
				<div
					className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 rounded-lg px-3 py-3.5"
					key={row}
				>
					<Skeleton className="h-5 w-4/5" />
					<Skeleton className="size-4" />
					<Skeleton className="col-span-2 h-4 w-72 max-w-full" />
				</div>
			))}
		</div>
	);
}
