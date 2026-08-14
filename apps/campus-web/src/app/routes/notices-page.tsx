import {
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	Input,
	Label,
	NativeSelect,
	Skeleton,
} from "@campus-agent/ui";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type {
	NoticeDomain,
	NoticeListItem,
	NoticeListRequestQuery,
	NoticeListResponse,
} from "campus-contracts/notices";
import {
	ArrowLeft,
	ArrowRight,
	ArrowUpRight,
	ChevronDown,
	ChevronRight,
	FileText,
	Globe2,
	Landmark,
	MessageCircle,
	Newspaper,
	School,
	Search,
	SlidersHorizontal,
	X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { SurfaceState } from "@/components/ui/surface-state";
import { NoticeDomainBadge } from "@/features/notices/domain-badge";
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
const MOBILE_FILTER_QUERY = "(max-width: 767px)";

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
	const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(() => !isMobileFilterViewport());
	useEffect(() => setQueryDraft(search.q ?? ""), [search.q]);
	useEffect(() => {
		const media = window.matchMedia(MOBILE_FILTER_QUERY);
		const syncOpenState = () => setAdvancedFiltersOpen(!media.matches);
		media.addEventListener("change", syncOpenState);
		return () => media.removeEventListener("change", syncOpenState);
	}, []);

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

	const hasFilters = Boolean(
		search.q ||
			search.domain ||
			search.organization_id ||
			search.notice_type ||
			search.is_external !== undefined ||
			search.from ||
			search.to,
	);
	const advancedFilterCount = [
		search.domain,
		search.organization_id,
		search.notice_type,
		search.is_external,
		search.from,
		search.to,
	].filter((value) => value !== undefined).length;

	return (
		<section className="mx-auto w-full max-w-[var(--layout-page-workspace-width)] px-4 py-6 pb-20 sm:px-5 lg:px-6">
			<header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
				<div>
					<h1 className="text-2xl font-semibold tracking-normal text-[var(--sys-text-strong)] md:text-3xl">
						通知目录
					</h1>
					<p className="mt-1 text-sm text-[var(--sys-text-muted)]">
						{notices.data
							? `已收录 ${notices.data.pagination.totalItems} 条符合条件的通知`
							: "查询已收录通知"}
					</p>
				</div>
				{hasFilters ? (
					<Button
						onClick={() => {
							setQueryDraft("");
							void navigate({ search: { page: 1 } });
						}}
						size="sm"
						variant="ghost"
					>
						<X />
						清除筛选
					</Button>
				) : null}
			</header>

			<form
				aria-label="通知筛选"
				className="grid gap-x-3 gap-y-4 border-b border-border py-5 md:grid-cols-2 xl:grid-cols-12"
				onSubmit={submitSearch}
			>
				<div className="md:col-span-2 xl:col-span-6">
					<Label htmlFor="notice-search">标题或正文关键词</Label>
					<div className="mt-1.5 flex gap-2">
						<Input
							id="notice-search"
							maxLength={100}
							onChange={(event) => setQueryDraft(event.target.value)}
							placeholder="搜索标题或正文"
							value={queryDraft}
						/>
						<Button aria-label="搜索通知" className="shrink-0" size="icon" type="submit">
							<Search />
						</Button>
					</div>
				</div>
				<Collapsible
					className="contents"
					onOpenChange={setAdvancedFiltersOpen}
					open={advancedFiltersOpen}
				>
					<div className="md:hidden">
						<CollapsibleTrigger asChild>
							<Button className="group w-full justify-start" variant="outline">
								<SlidersHorizontal />
								筛选条件{advancedFilterCount > 0 ? `（${advancedFilterCount}）` : ""}
								<ChevronDown className="ml-auto transition-transform group-data-[state=open]:rotate-180" />
							</Button>
						</CollapsibleTrigger>
					</div>
					<CollapsibleContent className="grid gap-4 md:contents">
						<FilterSelect
							className="min-w-0 xl:col-span-3"
							id="notice-domain"
							label="领域"
							onChange={(value) => updateSearch({ domain: value as NoticeDomain | undefined })}
							options={(notices.data?.filters.domains ?? []).map((option) => ({
								label: option.label,
								value: option.value,
							}))}
							value={search.domain}
						/>
						<SourceFilter
							className="min-w-0 xl:col-span-3"
							onChange={(value) => updateSearch({ is_external: value })}
							value={search.is_external}
						/>
						<FilterSelect
							className="min-w-0 xl:col-span-3"
							id="notice-type"
							label="门户类型"
							onChange={(value) => updateSearch({ notice_type: value ? Number(value) : undefined })}
							options={(notices.data?.filters.noticeTypes ?? []).map((option) => ({
								label: option.label,
								value: String(option.value),
							}))}
							value={search.notice_type === undefined ? undefined : String(search.notice_type)}
						/>
						<FilterSelect
							className="min-w-0 xl:col-span-5"
							id="notice-organization"
							label="发布部门"
							onChange={(value) => updateSearch({ organization_id: value })}
							options={(notices.data?.filters.organizations ?? []).map((option) => ({
								label: option.label,
								value: option.value,
							}))}
							value={search.organization_id}
						/>
						<DateRangeFilter
							className="min-w-0 md:col-span-2 xl:col-span-4"
							from={search.from}
							onFromChange={(value) => updateSearch({ from: value })}
							onToChange={(value) => updateSearch({ to: value })}
							to={search.to}
						/>
					</CollapsibleContent>
				</Collapsible>
			</form>

			<div aria-live="polite" className="min-h-80">
				{notices.isPending ? <NoticeListSkeleton /> : null}
				{notices.isError ? (
					<SurfaceState
						className="mt-6"
						description="通知目录暂时无法读取，请稍后重试。"
						kind="error"
						primaryAction={<Button onClick={() => void notices.refetch()}>重试</Button>}
						title="通知目录不可用"
					/>
				) : null}
				{notices.data && notices.data.items.length === 0 ? (
					<SurfaceState
						className="mt-6 border-dashed"
						description="调整关键词、领域或日期范围后再试。"
						kind="empty"
						title="没有符合条件的通知"
					/>
				) : null}
				{notices.data && notices.data.items.length > 0 ? (
					<NoticeResults data={notices.data} pending={notices.isPlaceholderData} />
				) : null}
			</div>
		</section>
	);
}

function FilterSelect(props: {
	className?: string;
	id: string;
	label: string;
	onChange: (value: string | undefined) => void;
	options: ReadonlyArray<{ label: string; value: string }>;
	value: string | undefined;
}) {
	return (
		<div className={props.className}>
			<Label htmlFor={props.id}>{props.label}</Label>
			<NativeSelect
				className="mt-1.5"
				id={props.id}
				onChange={(event) => props.onChange(event.target.value || undefined)}
				value={props.value ?? ""}
			>
				<option value="">全部</option>
				{props.options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</NativeSelect>
		</div>
	);
}

function SourceFilter(props: {
	className?: string;
	onChange: (value: boolean | undefined) => void;
	value: boolean | undefined;
}) {
	const options = [
		{ label: "全部", value: "all" },
		{ label: "站内正文", value: "internal" },
		{ label: "外部链接", value: "external" },
	] as const;
	const selectedValue =
		props.value === true ? "external" : props.value === false ? "internal" : "all";

	return (
		<div className={props.className}>
			<div>
				<span className="text-sm font-medium leading-none" id="notice-source-label">
					正文来源
				</span>
			</div>
			<div
				aria-labelledby="notice-source-label"
				className="mt-1.5 grid min-h-[var(--ui-control-height)] grid-cols-3 gap-1 rounded-md border border-input bg-background p-1 shadow-[var(--shadow-xs)]"
				role="radiogroup"
			>
				{options.map((option) => (
					<label className="relative min-w-0" key={option.value}>
						<input
							checked={selectedValue === option.value}
							className="peer sr-only"
							name="notice-source"
							onChange={() =>
								props.onChange(
									option.value === "external"
										? true
										: option.value === "internal"
											? false
											: undefined,
								)
							}
							type="radio"
							value={option.value}
						/>
						<span className="flex h-full min-h-8 items-center justify-center rounded-sm px-2 text-center text-sm text-[var(--sys-text-muted)] transition-[color,background-color,box-shadow] hover:bg-surface-hover hover:text-foreground peer-checked:bg-[var(--sys-bg-muted)] peer-checked:text-[var(--sys-text-strong)] peer-checked:shadow-[var(--shadow-xs)] peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
							{option.label}
						</span>
					</label>
				))}
			</div>
		</div>
	);
}

function DateRangeFilter(props: {
	className?: string;
	from: string | undefined;
	onFromChange: (value: string | undefined) => void;
	onToChange: (value: string | undefined) => void;
	to: string | undefined;
}) {
	return (
		<fieldset className={`${props.className ?? ""} m-0 border-0 p-0`}>
			<legend className="sr-only">发布日期</legend>
			<div>
				<span aria-hidden="true" className="text-sm font-medium leading-none">
					发布日期
				</span>
			</div>
			<div className="mt-1.5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
				<div>
					<Label
						className="mb-1.5 block text-xs text-[var(--sys-text-muted)] sm:sr-only"
						htmlFor="notice-from"
					>
						开始
					</Label>
					<Input
						className={
							props.from
								? "min-w-0 tabular-nums"
								: "min-w-0 tabular-nums text-[var(--sys-text-muted)]"
						}
						id="notice-from"
						max={props.to}
						onChange={(event) => props.onFromChange(event.target.value || undefined)}
						type="date"
						value={props.from ?? ""}
					/>
				</div>
				<span aria-hidden="true" className="hidden text-sm text-[var(--sys-text-muted)] sm:block">
					至
				</span>
				<div>
					<Label
						className="mb-1.5 block text-xs text-[var(--sys-text-muted)] sm:sr-only"
						htmlFor="notice-to"
					>
						结束
					</Label>
					<Input
						className={
							props.to
								? "min-w-0 tabular-nums"
								: "min-w-0 tabular-nums text-[var(--sys-text-muted)]"
						}
						id="notice-to"
						min={props.from}
						onChange={(event) => props.onToChange(event.target.value || undefined)}
						type="date"
						value={props.to ?? ""}
					/>
				</div>
			</div>
		</fieldset>
	);
}

function NoticeResults({ data, pending }: { data: NoticeListResponse; pending: boolean }) {
	const navigate = useNavigate({ from: "/notices" });
	return (
		<div className={pending ? "opacity-60" : undefined}>
			<ul className="divide-y divide-border" data-testid="notice-list">
				{data.items.map((item) => (
					<li key={item.noticeId}>
						<NoticeRow item={item} />
					</li>
				))}
			</ul>
			<nav
				aria-label="通知分页"
				className="flex min-h-16 items-center justify-between gap-4 border-t border-border"
			>
				<p className="text-sm tabular-nums text-[var(--sys-text-muted)]">
					第 {data.pagination.page} / {data.pagination.totalPages} 页
				</p>
				<div className="flex gap-2">
					<Button
						disabled={pending || data.pagination.page <= 1}
						onClick={() =>
							void navigate({
								search: (previous) => ({ ...previous, page: previous.page - 1 }),
							})
						}
						size="sm"
						variant="outline"
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
						variant="outline"
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
		<div className="grid min-h-28 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 py-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:gap-x-6">
			<div className="min-w-0">
				<NoticeDomainBadge domain={item.domain} />
			</div>
			<div className="flex min-h-[22px] items-center justify-end gap-2 text-sm text-[var(--sys-text-muted)] sm:grid sm:grid-cols-[9rem_1rem] sm:gap-3">
				<time
					className="whitespace-nowrap text-right tabular-nums sm:w-36"
					dateTime={item.releasedAt}
				>
					{RELEASE_DATE_FORMATTER.format(new Date(item.releasedAt))}
				</time>
				<span aria-hidden="true" className="flex size-4 items-center justify-center">
					{item.isExternal ? (
						<ArrowUpRight className="size-4" />
					) : (
						<ChevronRight className="size-4" />
					)}
				</span>
			</div>
			<h2 className="col-span-2 break-words text-base font-semibold leading-6 tracking-normal text-[var(--sys-text-strong)] group-hover:text-link">
				{item.title}
			</h2>
			<NoticeMetadata
				className="col-span-2"
				organization={item.organization?.name ?? "发布部门未标注"}
				source={source}
				type={item.noticeType.name}
			/>
		</div>
	);
	const className =
		"group block rounded-sm px-2 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
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
	className,
	organization,
	source,
	type,
}: {
	className?: string;
	organization: string;
	source: { kind: ExternalNoticeSourceKind; label: string; title: string };
	type: string;
}) {
	const SourceIcon = NOTICE_SOURCE_ICONS[source.kind];
	return (
		<p
			className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--sys-text-muted)] ${className ?? ""}`}
		>
			<span className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={source.title}>
				<SourceIcon aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="truncate">{source.label}</span>
			</span>
			<span className="inline-flex min-w-0 max-w-full items-center gap-2">
				<span aria-hidden="true" className="hidden text-border sm:inline">
					·
				</span>
				<span className="break-words">{organization}</span>
			</span>
			<span className="inline-flex min-w-0 max-w-full items-center gap-2">
				<span aria-hidden="true" className="hidden text-border sm:inline">
					·
				</span>
				<span className="break-words">{type}</span>
			</span>
		</p>
	);
}

function isMobileFilterViewport(): boolean {
	return typeof window !== "undefined" && window.matchMedia(MOBILE_FILTER_QUERY).matches;
}

function NoticeListSkeleton() {
	const rows = ["first", "second", "third", "fourth", "fifth", "sixth"];
	return (
		<div aria-label="正在读取通知" className="divide-y divide-border" role="status">
			{rows.map((row) => (
				<div
					className="grid min-h-28 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-2 py-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:gap-x-6"
					key={row}
				>
					<Skeleton className="h-5 w-20" />
					<Skeleton className="h-4 w-40 justify-self-end" />
					<Skeleton className="col-span-2 h-5 w-4/5" />
					<Skeleton className="col-span-2 h-3 w-64 max-w-full" />
				</div>
			))}
		</div>
	);
}
