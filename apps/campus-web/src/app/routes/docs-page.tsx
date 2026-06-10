import { useLocation } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/shell/state-panels";
import { SupportSurfaceShell } from "@/components/shell/support-surface-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getDocsNavigation, resolveDocument, searchDocs } from "@/features/docs/api";
import type {
	DocsNavigationResponse,
	DocsResolveResponse,
	DocsSearchResponse,
} from "@/features/docs/model";
import {
	buildVersionReaderHref,
	parseReaderLocationState,
	type ReaderLocationState,
} from "@/features/docs/reader-state";

const DEFAULT_DOCS = {
	collection: "student_rules",
	corpus: "regulations",
	documentSlug: "index",
};

export function DocsPage() {
	const location = useLocation();
	const routeParts = useMemo(
		() => parseDocsPath(location.pathname, `${location.search}${location.hash}`),
		[location.hash, location.pathname, location.search],
	);
	const [navigation, setNavigation] = useState<DocsNavigationResponse | null>(null);
	const [document, setDocument] = useState<DocsResolveResponse | null>(null);
	const [search, setSearch] = useState<DocsSearchResponse | null>(null);
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		setSearch(null);
		Promise.all([
			getDocsNavigation(routeParts),
			resolveDocument({
				anchor: routeParts.readerState.anchor,
				...routeParts,
				documentSlug: routeParts.documentSlug,
				highlightRootUnitIds: routeParts.readerState.highlightRootUnitIds,
				versionSlug: routeParts.versionSlug,
			}),
		])
			.then(([nextNavigation, nextDocument]) => {
				if (cancelled) {
					return;
				}
				setNavigation(nextNavigation);
				setDocument(nextDocument);
				setError(null);
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
				setNavigation(null);
				setDocument(null);
				setError("文档暂时无法打开。");
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [routeParts]);

	async function handleSearch() {
		if (!query.trim()) {
			setSearch(null);
			return;
		}
		setError(null);
		try {
			setSearch(await searchDocs({ ...routeParts, query }));
		} catch {
			setSearch(null);
			setError("搜索暂时不可用。");
		}
	}

	const toolbar = (
		<div className="flex gap-2 md:w-[360px]">
			<Input
				aria-label="搜索文档"
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						void handleSearch();
					}
				}}
				placeholder="搜索文档"
				value={query}
			/>
			<Button aria-label="搜索" className="size-11 shrink-0 px-0" onClick={handleSearch}>
				<Search aria-hidden="true" className="size-5" />
			</Button>
		</div>
	);

	return (
		<SupportSurfaceShell
			contentClassName="grid gap-5 lg:grid-cols-[var(--layout-docs-sidebar-width)_minmax(0,var(--layout-docs-content-width))_var(--layout-docs-toc-width)]"
			eyebrow={navigation?.collection.displayName ?? "校园文档"}
			title="文档"
			toolbar={toolbar}
		>
			<aside className="hidden lg:block">
				<Card className="sticky top-24 p-3">
					<p className="px-3 py-2 text-xs font-medium text-[var(--sys-text-subtle)]">
						{navigation?.collection.displayName ?? "文档"}
					</p>
					<div className="space-y-1">
						{navigation?.nodes.map((node) => (
							<a
								className="block rounded-lg px-3 py-2 text-sm text-[var(--sys-text-muted)] hover:bg-[var(--sys-bg-muted)]"
								href={node.canonicalUrl}
								key={`${node.kind}-${node.documentSlug}-${node.title}`}
							>
								{node.title}
							</a>
						))}
					</div>
				</Card>
			</aside>
			<section className="min-w-0">
				{error ? (
					<ErrorPanel message={error} />
				) : loading ? (
					<LoadingPanel label="正在读取文档" />
				) : search ? (
					<SearchResults search={search} />
				) : document ? (
					<ReaderRouteSummary
						collectionLabel={navigation?.collection.displayName ?? "校园文档"}
						document={document}
						readerState={routeParts.readerState}
					/>
				) : (
					<EmptyPanel message="当前文档暂无可打开的阅读页。" />
				)}
			</section>
			<aside className="hidden lg:block">
				<Card className="sticky top-24 p-4 text-sm text-[var(--sys-text-muted)]">
					<p className="font-medium text-[var(--sys-text-strong)]">本页信息</p>
					<p className="mt-3">资料来源：{navigation?.collection.displayName ?? "校园文档"}</p>
					<p className="mt-2">版本：{document?.resolvedVersion.label ?? "当前版"}</p>
				</Card>
			</aside>
		</SupportSurfaceShell>
	);
}

function ReaderRouteSummary({
	collectionLabel,
	document,
	readerState,
}: {
	collectionLabel: string;
	document: DocsResolveResponse;
	readerState: ReaderLocationState;
}) {
	const readerHref = buildVersionReaderHref({
		collection: document.document.collection,
		corpus: document.document.corpus,
		documentSlug: document.document.documentSlug,
		isCurrent: document.resolvedVersion.isCurrent,
		readerState,
		versionSlug: document.resolvedVersion.versionSlug,
	});
	return (
		<article className="rounded-2xl border border-border bg-white p-6 md:p-8">
			<p className="text-sm font-medium text-primary">{collectionLabel}</p>
			<h1 className="mt-3 text-3xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
				{document.document.title}
			</h1>
			<p className="mt-4 text-sm text-[var(--sys-text-muted)]">
				更新：{new Date(document.document.updatedAt).toLocaleDateString("zh-CN")}
			</p>
			<dl className="mt-6 grid gap-3 text-sm text-[var(--sys-text-muted)] md:grid-cols-2">
				<div>
					<dt className="font-medium text-[var(--sys-text-strong)]">版本</dt>
					<dd className="mt-1">{document.resolvedVersion.label}</dd>
				</div>
				<div>
					<dt className="font-medium text-[var(--sys-text-strong)]">阅读目标</dt>
					<dd className="mt-1 break-all">{readerHref}</dd>
				</div>
			</dl>
			<a
				className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-white"
				href={readerHref}
			>
				打开文档
			</a>
		</article>
	);
}

function SearchResults({ search }: { search: DocsSearchResponse }) {
	if (search.results.length === 0) {
		return <EmptyPanel message="没有找到匹配的文档结果。" />;
	}
	return (
		<div className="space-y-3">
			{search.results.map((result) => (
				<Card className="p-4" key={`${result.canonicalUrl}-${result.anchor}`}>
					<a
						className="text-base font-medium text-[var(--sys-text-strong)]"
						href={result.canonicalUrl}
					>
						{result.title}
					</a>
					<p className="mt-2 text-sm leading-6 text-[var(--sys-text-muted)]">{result.snippet}</p>
				</Card>
			))}
		</div>
	);
}

function parseDocsPath(pathname: string, searchAndHash: string) {
	const parts = pathname.split("/").filter(Boolean);
	const versionMarkerIndex = parts.indexOf("v");
	return {
		collection: parts[2] ?? DEFAULT_DOCS.collection,
		corpus: parts[1] ?? DEFAULT_DOCS.corpus,
		documentSlug: parts[3] ?? DEFAULT_DOCS.documentSlug,
		readerState: parseReaderLocationState(`${pathname}${searchAndHash}`),
		versionSlug: versionMarkerIndex >= 0 ? (parts[versionMarkerIndex + 1] ?? null) : null,
	};
}
