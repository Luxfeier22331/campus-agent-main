import { Badge, Button, cn, Input, Skeleton } from "@campus-agent/ui";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ArrowUp, Check, Copy, ExternalLink, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StateMessage } from "@/components/ui/state-message";
import {
	countInterestGroups,
	filterInterestGroupCatalog,
	getQqGroupAvatarUrl,
	getSafeGroupJoinLink,
	type InterestGroup,
	type InterestGroupCatalog,
} from "@/features/interest-groups/model";
import { interestGroupCatalogQueryOptions } from "@/features/interest-groups/query";
import { interestGroupQueryClient } from "@/features/interest-groups/query-client";

type CopyState = {
	groupId: string;
	status: "error" | "success";
} | null;

export function InterestGroupsPage() {
	return (
		<QueryClientProvider client={interestGroupQueryClient}>
			<InterestGroupsPageQuery />
		</QueryClientProvider>
	);
}

function InterestGroupsPageQuery() {
	const query = useQuery(interestGroupCatalogQueryOptions());
	if (query.isPending) {
		return (
			<section className="mx-auto max-w-[var(--layout-page-workspace-width)] px-4 py-7 sm:px-5 lg:px-6">
				<InterestGroupsPageSkeleton />
			</section>
		);
	}
	if (query.isError) {
		return <InterestGroupsUnavailable onRetry={() => void query.refetch()} />;
	}
	return <InterestGroupsPageContent catalog={query.data} />;
}

export function InterestGroupsUnavailable({ onRetry }: { onRetry: () => void }) {
	return (
		<section className="mx-auto max-w-[var(--layout-page-workspace-width)] px-4 py-7 sm:px-5 lg:px-6">
			<StateMessage
				description="暂时无法读取同好群目录，请稍后重试。"
				layout="page"
				primaryAction={
					<Button onClick={onRetry} variant="outline">
						重试
					</Button>
				}
				role="alert"
				title="同好群目录暂时不可用"
				tone="danger"
			/>
		</section>
	);
}

export function InterestGroupsPageSkeleton() {
	const groupSkeletonIds = ["group-1", "group-2", "group-3", "group-4", "group-5", "group-6"];

	return (
		<div aria-busy="true" aria-label="正在加载同好群目录" className="grid gap-7" role="status">
			<div aria-hidden="true" className="grid gap-3">
				<Skeleton className="h-9 w-28 motion-reduce:animate-none" />
				<Skeleton className="mx-auto h-11 w-full max-w-xl rounded-full motion-reduce:animate-none" />
			</div>
			<div aria-hidden="true" className="grid gap-3 lg:grid-cols-[12rem_minmax(0,1fr)]">
				<Skeleton className="hidden h-32 w-full motion-reduce:animate-none lg:block" />
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{groupSkeletonIds.map((id) => (
						<Skeleton className="h-32 w-full motion-reduce:animate-none" key={id} />
					))}
				</div>
			</div>
		</div>
	);
}

export function InterestGroupsPageContent({ catalog }: { catalog: InterestGroupCatalog }) {
	const [query, setQuery] = useState("");
	const [copyState, setCopyState] = useState<CopyState>(null);
	const [activeSectionId, setActiveSectionId] = useState<string | null>(
		catalog.sections[0]?.id ?? null,
	);
	const [showBackToTop, setShowBackToTop] = useState(false);
	const filteredCatalog = useMemo(
		() => filterInterestGroupCatalog(catalog, query),
		[catalog, query],
	);
	const totalCount = countInterestGroups(catalog);
	const resultCount = countInterestGroups(filteredCatalog);
	const hasQuery = query.trim().length > 0;

	useEffect(() => {
		if (!copyState) {
			return;
		}
		const timeout = window.setTimeout(() => setCopyState(null), 2_400);
		return () => window.clearTimeout(timeout);
	}, [copyState]);

	useEffect(() => {
		const sectionIds = new Set(filteredCatalog.sections.map((section) => section.id));
		setActiveSectionId((current) =>
			current && sectionIds.has(current) ? current : (filteredCatalog.sections[0]?.id ?? null),
		);
	}, [filteredCatalog.sections]);

	useEffect(() => {
		const updateBackToTopVisibility = () => setShowBackToTop(window.scrollY > 480);
		updateBackToTopVisibility();
		window.addEventListener("scroll", updateBackToTopVisibility, { passive: true });
		return () => window.removeEventListener("scroll", updateBackToTopVisibility);
	}, []);

	useEffect(() => {
		if (filteredCatalog.sections.length === 0 || typeof IntersectionObserver === "undefined") {
			return;
		}

		const sections = filteredCatalog.sections
			.map((section) => document.getElementById(section.id))
			.filter((section): section is HTMLElement => section !== null);
		if (sections.length === 0) {
			return;
		}

		const observer = new IntersectionObserver(
			() => {
				const passedSections = sections.filter(
					(section) => section.getBoundingClientRect().top <= 96,
				);
				const isAtPageBottom =
					window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
				const currentSection = isAtPageBottom
					? sections.at(-1)
					: (passedSections.at(-1) ?? sections[0]);
				if (currentSection) {
					setActiveSectionId(currentSection.id);
				}
			},
			{ rootMargin: "-96px 0px -20% 0px", threshold: 0 },
		);
		for (const section of sections) {
			observer.observe(section);
		}
		return () => observer.disconnect();
	}, [filteredCatalog.sections]);

	async function copyGroupNumber(group: InterestGroup) {
		if (!group.qqGroupNumber) {
			return;
		}
		try {
			await navigator.clipboard.writeText(group.qqGroupNumber);
			setCopyState({ groupId: group.id, status: "success" });
		} catch {
			setCopyState({ groupId: group.id, status: "error" });
		}
	}

	return (
		<section
			className="mx-auto max-w-[var(--layout-page-workspace-width)] px-4 py-7 pb-20 sm:px-5 lg:px-6"
			id="interest-groups-top"
		>
			<header>
				<h1 className="ui-page-title">同好群</h1>
			</header>

			<div className="mt-7 min-w-0">
				<div className="mx-auto max-w-xl">
					<div className="relative">
						<Search
							aria-hidden="true"
							className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--sys-text-subtle)]"
						/>
						<Input
							aria-label="搜索同好群"
							aria-controls="interest-groups-results"
							className="h-11 appearance-none rounded-full bg-surface-muted pl-10 pr-11 shadow-[var(--shadow-xs)] focus-visible:bg-background [&::-webkit-search-cancel-button]:appearance-none"
							disabled={totalCount === 0}
							id="interest-group-search"
							name="interest-group-search"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="搜索群名、群号、标签或说明"
							type="search"
							value={query}
						/>
						{hasQuery ? (
							<Button
								aria-label="清除搜索内容"
								className="absolute right-0 top-0 size-11 rounded-full"
								onClick={() => setQuery("")}
								size="icon-lg"
								title="清除搜索内容"
								type="button"
								variant="ghost"
							>
								<X aria-hidden="true" />
							</Button>
						) : null}
					</div>
					<p aria-live="polite" className="mt-2 text-center text-xs text-[var(--sys-text-subtle)]">
						{hasQuery ? `找到 ${resultCount} 条` : `共收录 ${totalCount} 条目录`}
					</p>
				</div>

				<div
					className={cn(
						"mt-6 grid items-start gap-8",
						filteredCatalog.sections.length > 0
							? "lg:grid-cols-[12rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)]"
							: "",
					)}
				>
					{filteredCatalog.sections.length > 0 ? (
						<CategoryNavigation
							activeSectionId={activeSectionId}
							catalog={filteredCatalog}
							onSelect={setActiveSectionId}
						/>
					) : null}

					<div className="min-w-0" id="interest-groups-results">
						<p aria-live="polite" className="sr-only">
							{copyState?.status === "success"
								? "群号已复制"
								: copyState?.status === "error"
									? "无法复制群号"
									: ""}
						</p>

						{totalCount === 0 ? (
							<StateMessage
								className="mt-8 lg:mt-0"
								description="还没有可展示的群。"
								layout="section"
								title="暂无已收录的同好群"
							/>
						) : resultCount === 0 ? (
							<StateMessage
								className="mt-8 lg:mt-0"
								description="请尝试其他主题、群号、群名或说明。"
								layout="section"
								primaryAction={
									<Button onClick={() => setQuery("")} type="button" variant="outline">
										清除搜索
									</Button>
								}
								title="没有找到匹配的群"
							/>
						) : (
							<div className="space-y-12">
								{filteredCatalog.sections.map((section) => (
									<section
										aria-labelledby={`${section.id}-heading`}
										className="scroll-mt-24"
										id={section.id}
										key={section.id}
									>
										<div className="mb-4 flex items-end justify-between gap-3 border-b border-border pb-3">
											<h2
												className="text-xl font-semibold tracking-normal text-[var(--sys-text-strong)]"
												id={`${section.id}-heading`}
											>
												{section.name}
											</h2>
											<span className="text-xs tabular-nums text-[var(--sys-text-subtle)]">
												{section.groups.length} 条
											</span>
										</div>
										<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
											{section.groups.map((group) => (
												<GroupCard
													copyState={copyState?.groupId === group.id ? copyState.status : null}
													group={group}
													key={group.id}
													onCopy={() => void copyGroupNumber(group)}
												/>
											))}
										</ul>
									</section>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
			{showBackToTop ? (
				<a
					aria-label="返回顶部"
					className="fixed bottom-5 right-4 z-20 inline-flex size-11 items-center justify-center rounded-full border border-border bg-background/95 text-[var(--sys-text-muted)] shadow-[var(--shadow-sm)] backdrop-blur-sm transition-[color,background-color,box-shadow,transform] hover:-translate-y-0.5 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:translate-y-px motion-reduce:transform-none"
					href="#interest-groups-top"
					title="返回顶部"
				>
					<ArrowUp aria-hidden="true" className="size-4" />
				</a>
			) : null}
		</section>
	);
}

function CategoryNavigation({
	activeSectionId,
	catalog,
	onSelect,
}: {
	activeSectionId: string | null;
	catalog: InterestGroupCatalog;
	onSelect: (sectionId: string) => void;
}) {
	return (
		<nav aria-label="同好群分类" className="min-w-0 lg:sticky lg:top-24">
			<p className="px-1 text-xs font-semibold text-[var(--sys-text-subtle)]">按分类浏览</p>
			<ul className="mt-2 flex w-full min-w-0 gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible lg:border-l lg:border-border lg:pl-2">
				{catalog.sections.map((section) => (
					<li className="shrink-0 lg:w-full" key={section.id}>
						<a
							aria-current={activeSectionId === section.id ? "location" : undefined}
							className={cn(
								"group flex min-h-11 shrink-0 items-center justify-between gap-3 rounded-full border px-4 text-sm transition-[color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full lg:rounded-md lg:border-0 lg:border-l-2 lg:px-3",
								activeSectionId === section.id
									? "border-border-selected bg-selected font-medium text-selected-foreground shadow-[var(--shadow-xs)] hover:bg-selected-hover active:bg-selected-pressed lg:border-border-selected lg:shadow-none"
									: "border-border bg-background text-[var(--sys-text-muted)] hover:bg-surface-hover hover:text-accent-foreground active:bg-surface-pressed lg:border-transparent lg:bg-transparent lg:shadow-none",
							)}
							href={`#${section.id}`}
							onClick={() => onSelect(section.id)}
						>
							{section.name}
							<span
								className={cn(
									"tabular-nums text-xs",
									activeSectionId === section.id
										? "text-selected-foreground"
										: "text-[var(--sys-text-subtle)]",
								)}
							>
								{section.groups.length}
							</span>
						</a>
					</li>
				))}
			</ul>
		</nav>
	);
}

function GroupCard({
	copyState,
	group,
	onCopy,
}: {
	copyState: "error" | "success" | null;
	group: InterestGroup;
	onCopy: () => void;
}) {
	const joinLink = getSafeGroupJoinLink(group.joinUrl);
	const avatarUrl = getQqGroupAvatarUrl(group.qqGroupNumber);
	const nameId = `${group.id}-name`;
	return (
		<li className="h-full min-w-0">
			<article
				aria-labelledby={nameId}
				className="group flex h-full min-h-40 min-w-0 flex-col rounded-[var(--card-radius)] border border-border bg-card p-4 transition-[border-color] duration-200 hover:border-border-default focus-within:border-border-selected sm:min-h-44 motion-reduce:transition-none"
			>
				<div className="flex min-w-0 items-start gap-3">
					{joinLink ? (
						<a
							aria-label={`打开 ${group.name} 的加入链接`}
							className="group/avatar shrink-0 rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
							href={joinLink.url}
							rel="noopener noreferrer"
							target="_blank"
							title="打开加入链接"
						>
							<GroupAvatar avatarUrl={avatarUrl} group={group} />
						</a>
					) : (
						<GroupAvatar avatarUrl={avatarUrl} group={group} />
					)}
					<div className="min-w-0 flex-1">
						<h3
							className="break-words text-base font-semibold leading-6 text-[var(--sys-text-strong)]"
							id={nameId}
						>
							{group.name}
						</h3>
						{group.tags.length > 0 ? (
							<ul
								aria-label="群标签"
								className="mt-2 flex min-w-0 flex-wrap gap-1.5 overflow-hidden"
							>
								{group.tags.map((tag) => (
									<li className="min-w-0 max-w-full" key={tag}>
										<Badge
											className="min-w-0 max-w-full border-border-selected bg-selected font-medium text-selected-foreground"
											tone="neutral"
										>
											<span className="block min-w-0 truncate" title={tag}>
												{tag}
											</span>
										</Badge>
									</li>
								))}
							</ul>
						) : null}
					</div>
				</div>

				<div className="mt-3 flex min-h-11 items-center justify-between gap-2 border-border border-t pt-2">
					<p className="min-w-0 text-sm text-[var(--sys-text-muted)]">
						<span className="text-xs text-[var(--sys-text-subtle)]">
							{group.qqGroupNumber
								? "QQ 群"
								: joinLink?.platform === "discord"
									? "Discord"
									: "加入方式"}
						</span>{" "}
						<span className="font-semibold tabular-nums text-[var(--sys-text-strong)]">
							{group.qqGroupNumber ?? (joinLink ? "邀请链接" : "暂未提供")}
						</span>
					</p>
					<div className="flex shrink-0 items-center gap-1">
						{copyState ? (
							<span
								aria-hidden="true"
								className={
									copyState === "success"
										? "text-xs text-[var(--sys-status-success)]"
										: "text-destructive text-xs"
								}
							>
								{copyState === "success" ? "已复制" : "复制失败"}
							</span>
						) : null}
						{group.qqGroupNumber ? (
							<Button
								aria-label={`复制群号 ${group.qqGroupNumber}`}
								className="size-11 shrink-0 -mr-2"
								onClick={onCopy}
								size="icon-lg"
								title={copyState === "error" ? "复制失败，请重试" : "复制群号"}
								type="button"
								variant="ghost"
							>
								{copyState === "success" ? (
									<Check aria-hidden="true" className="text-[var(--sys-status-success)]" />
								) : (
									<Copy
										aria-hidden="true"
										className={copyState === "error" ? "text-destructive" : ""}
									/>
								)}
							</Button>
						) : null}
					</div>
				</div>
				{group.summary ? (
					<p
						className="mt-2 break-words text-xs leading-5 text-[var(--sys-text-subtle)] sm:line-clamp-4"
						title={group.summary}
					>
						{group.summary}
					</p>
				) : null}
				{joinLink ? (
					<Button asChild className="mt-auto self-end" size="sm" variant="outline">
						<a
							aria-label={`加入 ${group.name}`}
							href={joinLink.url}
							rel="noopener noreferrer"
							target="_blank"
						>
							{joinLink.platform === "discord" ? "加入 Discord" : "加入群聊"}
							<ExternalLink aria-hidden="true" className="size-3.5" />
						</a>
					</Button>
				) : null}
			</article>
		</li>
	);
}

function GroupAvatar({ avatarUrl, group }: { avatarUrl: string | null; group: InterestGroup }) {
	return (
		<Avatar className="size-12 shrink-0 border border-border bg-surface-muted transition-transform duration-200 group-hover/avatar:scale-105">
			{avatarUrl ? (
				<AvatarImage
					alt={`${group.name}群头像`}
					decoding="async"
					loading="lazy"
					referrerPolicy="no-referrer"
					src={avatarUrl}
				/>
			) : null}
			<AvatarFallback className="bg-selected font-semibold text-selected-foreground">
				{getGroupAvatarFallback(group)}
			</AvatarFallback>
		</Avatar>
	);
}

function getGroupAvatarFallback(group: InterestGroup): string {
	return [...group.name.trim()][0] ?? "群";
}
