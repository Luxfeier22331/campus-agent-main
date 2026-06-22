import { useLocation } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { getDocsNavigation, resolveDocument } from "@/features/docs/api";
import type { DocsNavigationResponse, DocsResolveResponse } from "@/features/docs/model";
import {
	buildVersionReaderHref,
	parseReaderLocationState,
	type ReaderLocationState,
} from "@/features/docs/reader-state";

const DEFAULT_COLLECTION = {
	collection: "student_rules",
	corpus: "regulations",
};

type DocsRouteTarget =
	| {
			collection: string;
			corpus: string;
			kind: "collection";
			readerState: ReaderLocationState;
	  }
	| {
			collection: string;
			corpus: string;
			documentSlug: string;
			kind: "document";
			readerState: ReaderLocationState;
			versionSlug: string | null;
	  };

type DocsPageState =
	| { status: "loading" }
	| { message: string; status: "error" }
	| { navigation: DocsNavigationResponse; status: "collection" }
	| { document: DocsResolveResponse; status: "document" };

export function DocsPage() {
	const location = useLocation();
	const serializedSearch = serializeRouterSearch(location.search);
	const routeTarget = useMemo(
		() => parseDocsPath(location.pathname, `${serializedSearch}${location.hash}`),
		[location.hash, location.pathname, serializedSearch],
	);
	const [state, setState] = useState<DocsPageState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		setState({ status: "loading" });
		const load =
			routeTarget.kind === "collection"
				? getDocsNavigation({
						collection: routeTarget.collection,
						corpus: routeTarget.corpus,
					}).then((navigation) => ({ navigation, status: "collection" as const }))
				: resolveDocument({
						anchor: routeTarget.readerState.anchor,
						collection: routeTarget.collection,
						corpus: routeTarget.corpus,
						documentSlug: routeTarget.documentSlug,
						highlightRootUnitIds: routeTarget.readerState.highlightRootUnitIds,
						versionSlug: routeTarget.versionSlug,
					}).then((document) => ({ document, status: "document" as const }));

		load
			.then((nextState) => {
				if (!cancelled) {
					setState(nextState);
				}
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
				setState({ message: "文档暂时无法打开。", status: "error" });
			});
		return () => {
			cancelled = true;
		};
	}, [routeTarget]);

	return (
		<section className="mx-auto max-w-[960px] px-4 py-6 pb-24 lg:px-6">
			<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
				<div className="min-w-0">
					<p className="text-sm font-medium text-[var(--sys-text-muted)]">校园文档</p>
					<h1 className="mt-1 text-2xl font-semibold tracking-normal text-[var(--sys-text-strong)] md:text-3xl">
						文档
					</h1>
				</div>
			</div>
			<Separator className="mt-5" />
			<div className="mt-5 grid place-items-start">
				{state.status === "error" ? (
					<Alert variant="destructive">{state.message}</Alert>
				) : (
					<Card className="w-full max-w-2xl p-5">
						{state.status === "loading" ? (
							<div className="mt-4 rounded-lg border border-border bg-card p-6" role="status">
								<Skeleton className="h-4 w-32" />
								<span className="sr-only">
									{routeTarget.kind === "collection" ? "正在读取文档目录" : "正在准备文档"}
								</span>
							</div>
						) : state.status === "collection" ? (
							<CollectionDirectory navigation={state.navigation} />
						) : (
							<>
								<p className="text-sm font-medium text-[var(--sys-text-muted)]">正在打开文档</p>
								<ReaderHandoff document={state.document} readerState={routeTarget.readerState} />
							</>
						)}
					</Card>
				)}
			</div>
		</section>
	);
}

function CollectionDirectory({ navigation }: { navigation: DocsNavigationResponse }) {
	const { collection, nodes } = navigation;
	return (
		<>
			<p className="text-sm font-medium text-[var(--sys-text-muted)]">文档目录</p>
			<h2 className="mt-2 text-xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
				{collection.displayName}
			</h2>
			{collection.description ? (
				<p className="mt-2 text-sm leading-6 text-[var(--sys-text-muted)]">
					{collection.description}
				</p>
			) : null}
			{nodes.length > 0 ? (
				<ul className="mt-5 divide-y divide-[var(--sys-border-subtle)]">
					{nodes.map((node) => (
						<li key={node.documentSlug}>
							<a
								className="block py-3 text-sm font-medium leading-6 text-[var(--sys-text-strong)] hover:text-[var(--sys-brand-identity)]"
								href={node.canonicalUrl}
							>
								{node.displayTitle ?? node.title}
							</a>
						</li>
					))}
				</ul>
			) : (
				<Empty className="mt-5">
					<EmptyHeader>
						<EmptyTitle>暂无文档</EmptyTitle>
						<EmptyDescription>当前没有可阅读的文档。</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
		</>
	);
}

function ReaderHandoff({
	document,
	readerState,
}: {
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
		<>
			<h2 className="mt-2 text-xl font-semibold tracking-normal text-[var(--sys-text-strong)]">
				{document.document.title}
			</h2>
			<Button asChild className="mt-5">
				<a href={readerHref}>
					继续打开
					<ExternalLink aria-hidden="true" className="size-4" />
				</a>
			</Button>
		</>
	);
}

function parseDocsPath(pathname: string, searchAndHash: string): DocsRouteTarget {
	const parts = decodePathParts(pathname);
	const corpus = parts[1] ?? DEFAULT_COLLECTION.corpus;
	const collection = parts[2] ?? DEFAULT_COLLECTION.collection;
	const documentSlug = parts[3] && parts[3] !== "v" ? parts[3] : null;
	const readerState = parseReaderLocationState(`${pathname}${searchAndHash}`);
	if (!documentSlug) {
		return {
			collection,
			corpus,
			kind: "collection",
			readerState,
		};
	}
	const versionMarkerIndex = parts.indexOf("v");
	return {
		collection,
		corpus,
		documentSlug,
		kind: "document",
		readerState,
		versionSlug: versionMarkerIndex >= 0 ? (parts[versionMarkerIndex + 1] ?? null) : null,
	};
}

function decodePathParts(pathname: string): string[] {
	try {
		return pathname.split("/").filter(Boolean).map(decodeURIComponent);
	} catch {
		return pathname.split("/").filter(Boolean);
	}
}

function serializeRouterSearch(search: unknown): string {
	if (!search) {
		return "";
	}
	if (typeof search === "string") {
		return search;
	}
	if (search instanceof URLSearchParams) {
		const serialized = search.toString();
		return serialized ? `?${serialized}` : "";
	}
	if (typeof search !== "object") {
		return "";
	}

	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(search as Record<string, unknown>)) {
		if (value === null || value === undefined || value === "") {
			continue;
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				if (item !== null && item !== undefined && item !== "") {
					params.append(key, String(item));
				}
			}
			continue;
		}
		params.set(key, String(value));
	}
	const serialized = params.toString();
	return serialized ? `?${serialized}` : "";
}
