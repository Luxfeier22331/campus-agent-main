import {
	Button,
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
	Skeleton,
} from "@campus-agent/ui";
import { Link } from "@tanstack/react-router";
import { ArrowUp, ChevronDown, List, ListTree, Search, UserRound } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { CampusTopNav } from "@/components/navigation/campus-top-nav";
import { buildDocsNavigationGroups, type DocsSiteIndex } from "@/features/docs/site-index";
import type { DocsOutlineItem } from "./docs-reader-view";
import type { DocsSearchRuntime } from "./docs-search-dialog";

const loadDocsSearchPanel = () =>
	import("./docs-search-dialog").then((module) => ({ default: module.DocsSearchPanel }));
const DocsSearchPanel = lazy(loadDocsSearchPanel);

export function DocsShell({
	activePath,
	children,
	outline,
	searchRuntime,
	siteIndex,
}: {
	activePath: string;
	children: ReactNode;
	outline: readonly DocsOutlineItem[];
	searchRuntime?: DocsSearchRuntime;
	siteIndex: DocsSiteIndex;
}) {
	const [searchOpen, setSearchOpen] = useState(false);
	const searchNavigationRef = useRef(false);

	return (
		<Dialog onOpenChange={setSearchOpen} open={searchOpen}>
			<div className="docs-site" data-ui-profile="campus">
				<CampusTopNav
					accountAction={
						<Button asChild className="text-xs" size="icon" variant="ghost">
							<a aria-label="账号" href="/account">
								<UserRound aria-hidden="true" className="size-4" />
								<span className="sr-only">账号</span>
							</a>
						</Button>
					}
					activePath={activePath}
					compactBrandLabel="校园问答"
					contextLabel="校园文档"
					leadingAction={<MobileTree siteIndex={siteIndex} activePath={activePath} />}
					linkMode="anchor"
					mobileAccountAction={
						<Button asChild className="w-full justify-start" size="lg" variant="ghost">
							<a aria-label="账号" href="/account">
								<UserRound aria-hidden="true" className="size-4" />
								<span>账号</span>
							</a>
						</Button>
					}
					localActions={
						<>
							<DialogTrigger asChild>
								<Button
									aria-label="搜索校园文档"
									className="docs-search-trigger shrink-0"
									onFocus={() => void loadDocsSearchPanel()}
									onPointerEnter={() => void loadDocsSearchPanel()}
									size="icon"
									variant="ghost"
								>
									<Search aria-hidden="true" />
								</Button>
							</DialogTrigger>
							{outline.length > 0 ? <MobileOutline outline={outline} /> : null}
						</>
					}
					showLocalActionsOnMobile
					variant="workspace"
				/>
				<div className="docs-site-grid" data-has-outline={outline.length > 0 ? "true" : "false"}>
					<aside aria-label="文档目录侧栏" className="docs-tree-panel">
						<DocsTree activePath={activePath} siteIndex={siteIndex} />
					</aside>
					<main className="docs-main">{children}</main>
					{outline.length > 0 ? (
						<aside aria-label="本页目录侧栏" className="docs-outline-panel">
							<DocsOutline outline={outline} />
						</aside>
					) : null}
				</div>
				<BackToTop />
			</div>
			<DialogContent
				className="docs-search-dialog w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-[var(--radius-xl)] p-0 sm:max-w-2xl"
				closeLabel="关闭搜索"
				onCloseAutoFocus={(event) => {
					if (searchNavigationRef.current) {
						event.preventDefault();
						searchNavigationRef.current = false;
						return;
					}
				}}
			>
				<DialogTitle className="sr-only">搜索校园文档</DialogTitle>
				<Suspense fallback={<DocsSearchPanelPending />}>
					<DocsSearchPanel
						onNavigate={() => {
							searchNavigationRef.current = true;
							setSearchOpen(false);
						}}
						searchIndexUrl={siteIndex.searchIndexUrl}
						siteIndex={siteIndex}
						{...(searchRuntime ? { searchRuntime } : {})}
					/>
				</Suspense>
			</DialogContent>
		</Dialog>
	);
}

export function DocsTree({
	activePath,
	onNavigate,
	siteIndex,
}: {
	activePath: string;
	onNavigate?: () => void;
	siteIndex: DocsSiteIndex;
}) {
	const treeId = useId();
	const corpusGroups = useMemo(() => buildDocsNavigationGroups(siteIndex), [siteIndex]);
	const activeDocumentPath = useMemo(
		() =>
			siteIndex.collections
				.flatMap((collection) => collection.documents)
				.find((document) => isDocumentPathActive(activePath, document))?.canonicalUrl ?? null,
		[activePath, siteIndex],
	);
	const activeScope = useMemo(
		() =>
			activeDocumentPath
				? (corpusGroups
						.flatMap((group) => group.sections)
						.find((section) =>
							section.documents.some((document) => document.canonicalUrl === activeDocumentPath),
						)?.key ?? null)
				: null,
		[activeDocumentPath, corpusGroups],
	);
	const [expandedScopes, setExpandedScopes] = useState<Set<string>>(
		() => new Set(activeScope && activeDocumentPath ? [activeScope] : []),
	);
	const activeDocumentRef = useRef<HTMLAnchorElement>(null);

	useEffect(() => {
		if (activePath === "/docs") {
			setExpandedScopes(new Set());
			return;
		}
		if (!(activeScope && activeDocumentPath)) {
			return;
		}
		setExpandedScopes((current) => {
			if (current.has(activeScope)) {
				return current;
			}
			const next = new Set(current);
			next.add(activeScope);
			return next;
		});
	}, [activeDocumentPath, activePath, activeScope]);

	useEffect(() => {
		if (!(activeScope && activeDocumentPath && expandedScopes.has(activeScope))) {
			return;
		}
		activeDocumentRef.current?.scrollIntoView({ block: "nearest" });
	}, [activeDocumentPath, activeScope, expandedScopes]);

	function toggleScope(key: string) {
		setExpandedScopes((current) => {
			const next = new Set(current);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	}

	return (
		<nav aria-label="文档目录" className="docs-tree">
			<Link
				activeOptions={{ exact: true }}
				aria-current={activePath === "/docs" ? "page" : undefined}
				onClick={onNavigate}
				to={"/docs" as never}
			>
				全部文档
			</Link>
			{corpusGroups.map((group) => (
				<section className="docs-tree-corpus-group" key={group.corpus}>
					<p className="docs-tree-corpus">{group.label}</p>
					{group.sections.map((section) => {
						const key = section.key;
						const expanded = expandedScopes.has(key);
						const contentId = `${treeId}-${safeDomId(key)}`;
						return (
							<section className="docs-tree-group" key={key}>
								<div className="docs-tree-collection-row">
									<Button
										aria-controls={contentId}
										aria-expanded={expanded}
										className="docs-tree-collection"
										data-active={activeScope === key ? "true" : "false"}
										onClick={() => toggleScope(key)}
										type="button"
										variant="ghost"
									>
										<span>{section.label}</span>
										<ChevronDown aria-hidden="true" />
									</Button>
								</div>
								{expanded ? (
									<div id={contentId}>
										<ul>
											{section.documents.map((document) => {
												const active = isDocumentPathActive(activePath, document);
												return (
													<li key={document.canonicalUrl}>
														<Link
															activeOptions={{ exact: true }}
															aria-current={active ? "page" : undefined}
															onClick={onNavigate}
															ref={active ? activeDocumentRef : undefined}
															to={document.canonicalUrl as never}
														>
															{document.title}
														</Link>
													</li>
												);
											})}
										</ul>
									</div>
								) : null}
							</section>
						);
					})}
				</section>
			))}
		</nav>
	);
}

function DocsOutline({
	onNavigate,
	outline,
	showLabel = true,
}: {
	onNavigate?: () => void;
	outline: readonly DocsOutlineItem[];
	showLabel?: boolean;
}) {
	const activeAnchor = useActiveOutline(outline);
	const activeLinkRef = useRef<HTMLAnchorElement>(null);
	useEffect(() => {
		if (!activeAnchor) {
			return;
		}
		activeLinkRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeAnchor]);
	return (
		<nav aria-label="本页目录" className="docs-outline">
			{showLabel ? <p>本页目录</p> : null}
			<ul>
				{outline.map((item) => (
					<li data-level={item.level} key={item.anchor}>
						<a
							aria-current={activeAnchor === item.anchor ? "location" : undefined}
							href={`#${encodeURIComponent(item.anchor)}`}
							onClick={onNavigate}
							ref={activeAnchor === item.anchor ? activeLinkRef : undefined}
						>
							{item.title}
						</a>
					</li>
				))}
			</ul>
		</nav>
	);
}

function MobileTree(props: Parameters<typeof DocsTree>[0]) {
	const [open, setOpen] = useState(false);
	return (
		<Sheet onOpenChange={setOpen} open={open}>
			<SheetTrigger asChild>
				<Button
					aria-label="打开文档目录"
					className="shrink-0 lg:hidden"
					size="icon"
					variant="ghost"
				>
					<ListTree aria-hidden="true" />
				</Button>
			</SheetTrigger>
			<SheetContent className="docs-navigation-sheet overflow-y-auto p-0" side="left">
				<SheetHeader className="docs-navigation-sheet-header">
					<SheetTitle>文档目录</SheetTitle>
				</SheetHeader>
				<div className="p-4">
					<DocsTree {...props} onNavigate={() => setOpen(false)} />
				</div>
			</SheetContent>
		</Sheet>
	);
}

function MobileOutline({ outline }: { outline: readonly DocsOutlineItem[] }) {
	const [open, setOpen] = useState(false);
	return (
		<Sheet onOpenChange={setOpen} open={open}>
			<SheetTrigger asChild>
				<Button
					aria-label="打开本页目录"
					className="shrink-0 xl:hidden"
					size="icon"
					variant="ghost"
				>
					<List aria-hidden="true" />
				</Button>
			</SheetTrigger>
			<SheetContent className="docs-navigation-sheet overflow-y-auto p-0" side="right">
				<SheetHeader className="docs-navigation-sheet-header">
					<SheetTitle>本页目录</SheetTitle>
				</SheetHeader>
				<div className="p-4">
					<DocsOutline onNavigate={() => setOpen(false)} outline={outline} showLabel={false} />
				</div>
			</SheetContent>
		</Sheet>
	);
}

function useActiveOutline(outline: readonly DocsOutlineItem[]): string | null {
	const [active, setActive] = useState<string | null>(null);
	useEffect(() => {
		const elements = outline
			.map((item) => document.getElementById(item.anchor))
			.filter((item): item is HTMLElement => Boolean(item));
		if (elements.length === 0 || !("IntersectionObserver" in window)) {
			return;
		}
		const visible = new Map<string, number>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						visible.set(entry.target.id, entry.boundingClientRect.top);
					} else {
						visible.delete(entry.target.id);
					}
				}
				const first = [...visible.entries()].sort((left, right) => left[1] - right[1])[0];
				if (first) {
					setActive(first[0]);
				}
			},
			{ rootMargin: "-80px 0px -70% 0px" },
		);
		for (const element of elements) {
			observer.observe(element);
		}
		return () => observer.disconnect();
	}, [outline]);
	return active;
}

function isDocumentPathActive(activePath: string, document: { canonicalUrl: string }): boolean {
	return (
		activePath === document.canonicalUrl || activePath.startsWith(`${document.canonicalUrl}/v/`)
	);
}

function safeDomId(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/gu, "-");
}

function BackToTop() {
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		const update = () => setVisible(window.scrollY > 640);
		update();
		window.addEventListener("scroll", update, { passive: true });
		return () => window.removeEventListener("scroll", update);
	}, []);
	if (!visible) {
		return null;
	}
	return (
		<Button
			aria-label="返回顶部"
			className="docs-back-to-top"
			onClick={() =>
				window.scrollTo({
					behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
						? "auto"
						: "smooth",
					top: 0,
				})
			}
			size="icon"
			title="返回顶部"
			type="button"
			variant="outline"
		>
			<ArrowUp aria-hidden="true" />
		</Button>
	);
}

function DocsSearchPanelPending() {
	return (
		<div aria-busy="true" className="grid min-h-40 gap-3 px-4 py-5" role="status">
			<div aria-hidden="true" className="grid content-start gap-2">
				<Skeleton className="h-10 w-full motion-reduce:animate-none" />
				<Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
				<Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
			</div>
		</div>
	);
}
