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
import { ArrowUp, ChevronDown, List, Menu, Search, UserRound } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { ProductBrandLink, ProductNavActions } from "@/components/navigation/product-navigation";
import { ProductNavActionsWithIcons } from "@/components/navigation/product-navigation-menu";
import { buildDocsNavigationGroups, type DocsSiteIndex } from "@/features/docs/site-index";
import type { DocsOutlineItem } from "./docs-reader-view";

const loadDocsSearchPanel = () =>
	import("./docs-search-dialog").then((module) => ({ default: module.DocsSearchPanel }));
const DocsSearchPanel = lazy(loadDocsSearchPanel);

export function DocsShell({
	activePath,
	children,
	outline,
	siteIndex,
}: {
	activePath: string;
	children: ReactNode;
	outline: readonly DocsOutlineItem[];
	siteIndex: DocsSiteIndex;
}) {
	const [searchOpen, setSearchOpen] = useState(false);
	const searchNavigationRef = useRef(false);

	return (
		<Dialog onOpenChange={setSearchOpen} open={searchOpen}>
			<div className="docs-site">
				<header className="docs-site-header">
					<div className="docs-site-header-inner">
						<div className="flex min-w-0 items-center gap-1">
							<MobileTree siteIndex={siteIndex} activePath={activePath} />
							<ProductBrandLink
								className="docs-site-brand min-h-[var(--layout-docs-header-height)]"
								subtitle="校园文档"
							/>
						</div>
						<ProductNavActions
							activePath={activePath}
							className="hidden gap-1 lg:flex"
							linkMode="anchor"
						/>
						<div className="flex items-center gap-1">
							<DialogTrigger asChild>
								<Button
									aria-label="搜索校园文档"
									className="docs-search-trigger shrink-0"
									onFocus={() => void loadDocsSearchPanel()}
									onPointerEnter={() => void loadDocsSearchPanel()}
									size="icon-lg"
									variant="ghost"
								>
									<Search aria-hidden="true" />
								</Button>
							</DialogTrigger>
							{outline.length > 0 ? <MobileOutline outline={outline} /> : null}
							<Button asChild className="docs-account-link text-xs" size="lg" variant="ghost">
								<a aria-label="账号" href="/account">
									<UserRound aria-hidden="true" className="docs-account-icon" />
									<span className="docs-account-label">账号</span>
								</a>
							</Button>
						</div>
					</div>
				</header>
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
				className="docs-search-dialog w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-lg p-0 sm:max-w-2xl"
				closeLabel="关闭搜索"
				onCloseAutoFocus={(event) => {
					if (searchNavigationRef.current) {
						event.preventDefault();
						searchNavigationRef.current = false;
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
	const shouldAutoExpandActiveScope = Boolean(activeScope && activeDocumentPath);
	const allScopeKeys = useMemo(
		() => corpusGroups.flatMap((group) => group.sections.map((section) => section.key)),
		[corpusGroups],
	);
	const [expandedScopes, setExpandedScopes] = useState<Set<string>>(
		() =>
			new Set(
				activePath === "/docs"
					? allScopeKeys
					: shouldAutoExpandActiveScope && activeScope
						? [activeScope]
						: [],
			),
	);
	const previousActivePathRef = useRef(activePath);
	const docsIndexExpansionInitializedRef = useRef(false);
	const activeDocumentRef = useRef<HTMLAnchorElement>(null);

	useEffect(() => {
		const enteredDocsIndex = activePath === "/docs" && previousActivePathRef.current !== "/docs";
		previousActivePathRef.current = activePath;
		if (activePath === "/docs") {
			if (
				enteredDocsIndex ||
				(!docsIndexExpansionInitializedRef.current && allScopeKeys.length > 0)
			) {
				setExpandedScopes(new Set(allScopeKeys));
				if (allScopeKeys.length > 0) {
					docsIndexExpansionInitializedRef.current = true;
				}
			}
			return;
		}
		if (!activeScope) {
			return;
		}
		setExpandedScopes((current) => {
			const shouldBeExpanded = shouldAutoExpandActiveScope;
			if (current.has(activeScope) === shouldBeExpanded) {
				return current;
			}
			const next = new Set(current);
			if (shouldBeExpanded) {
				next.add(activeScope);
			} else {
				next.delete(activeScope);
			}
			return next;
		});
	}, [activePath, activeScope, allScopeKeys, shouldAutoExpandActiveScope]);

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
					size="icon-lg"
					variant="ghost"
				>
					<Menu aria-hidden="true" />
				</Button>
			</SheetTrigger>
			<SheetContent className="docs-navigation-sheet overflow-y-auto p-0" side="left">
				<SheetHeader className="border-b px-5 py-4 text-left">
					<SheetTitle>文档目录</SheetTitle>
				</SheetHeader>
				<div className="docs-mobile-product-links">
					<p>校园服务</p>
					<ProductNavActionsWithIcons
						activePath={props.activePath}
						className="docs-mobile-product-nav grid"
						linkMode="anchor"
					/>
				</div>
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
					size="icon-lg"
					variant="ghost"
				>
					<List aria-hidden="true" />
				</Button>
			</SheetTrigger>
			<SheetContent className="docs-navigation-sheet overflow-y-auto" side="right">
				<SheetHeader className="mb-4 text-left">
					<SheetTitle>本页目录</SheetTitle>
				</SheetHeader>
				<DocsOutline onNavigate={() => setOpen(false)} outline={outline} showLabel={false} />
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
			size="icon-lg"
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
		<div className="grid min-h-40 gap-3 px-4 py-5" role="status">
			<p className="m-0 text-sm text-muted-foreground">正在载入搜索</p>
			<div aria-hidden="true" className="grid content-start gap-2">
				<Skeleton className="h-10 w-full motion-reduce:animate-none" />
				<Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
				<Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
			</div>
		</div>
	);
}
