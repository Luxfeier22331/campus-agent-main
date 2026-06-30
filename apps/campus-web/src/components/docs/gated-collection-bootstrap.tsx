import { useEffect, useState } from "react";

import { buildAccountLoginUrlForCurrentRoute } from "@/platform/runtime/config";
import { DocsBootstrapStatus } from "./docs-bootstrap-status";

interface DocsNavigationResponse {
	collection: {
		collection: string;
		corpus: string;
		description?: string;
		displayName: string;
	};
	nodes: Array<{
		canonicalUrl: string;
		documentSlug: string;
		displayTitle?: string;
		isCurrent: boolean;
		kind: "document";
		title: string;
	}>;
}

interface CollectionRouteTarget {
	collection: string;
	corpus: string;
}

type CollectionState =
	| { status: "loading" }
	| { status: "not_found" }
	| { status: "unauthorized" }
	| { status: "unavailable" }
	| { navigation: DocsNavigationResponse; status: "ready" };

export default function GatedCollectionBootstrap() {
	const [state, setState] = useState<CollectionState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;

		async function loadCollection() {
			const target = parseCollectionRouteFromPath(window.location.pathname);
			if (!target) {
				setState({ status: "not_found" });
				return;
			}

			try {
				const response = await fetch(buildCollectionNavigationUrl(target), {
					credentials: "include",
					headers: { accept: "application/json" },
				});
				if (!response.ok) {
					setState(resolveFailureState(response.status));
					return;
				}

				const navigation = (await response.json()) as DocsNavigationResponse;
				if (!cancelled) {
					setState({ navigation, status: "ready" });
				}
			} catch {
				if (!cancelled) {
					setState({ status: "unavailable" });
				}
			}
		}

		void loadCollection();
		return () => {
			cancelled = true;
		};
	}, []);

	if (state.status === "loading") {
		return <DocsBootstrapStatus kind="loading" title="正在读取文档目录" />;
	}
	if (state.status === "not_found") {
		return (
			<DocsBootstrapStatus
				description="请确认当前账号可以访问这个目录。"
				kind="not_found"
				title="无法打开文档目录"
			/>
		);
	}
	if (state.status === "unauthorized") {
		return (
			<DocsBootstrapStatus
				action={<a href={resolveLoginHref()}>登录后继续</a>}
				description="登录后继续打开这个文档目录。"
				kind="unauthorized"
				title="请先登录"
			/>
		);
	}
	if (state.status === "unavailable") {
		return (
			<DocsBootstrapStatus
				action={
					<button type="button" onClick={() => window.location.reload()}>
						重试
					</button>
				}
				description="请稍后重试。"
				kind="unavailable"
				title="文档目录暂不可用"
			/>
		);
	}

	const { collection, nodes } = state.navigation;
	return (
		<article className="reader-bootstrap-article gated-collection-bootstrap">
			<header className="document-meta-panel">
				<p className="document-meta-summary">
					<span>{collection.displayName}</span>
					<span>账号可见</span>
				</p>
				{collection.description ? <p>{collection.description}</p> : null}
			</header>
			<h1>{collection.displayName}</h1>
			{nodes.length > 0 ? (
				<ul className="gated-collection-list">
					{nodes.map((node) => (
						<li key={node.documentSlug}>
							<a href={node.canonicalUrl}>{node.displayTitle ?? node.title}</a>
						</li>
					))}
				</ul>
			) : (
				<p className="gated-collection-empty">当前账号下没有可阅读的文档。</p>
			)}
		</article>
	);
}

export function parseCollectionRouteFromPath(pathname: string): CollectionRouteTarget | null {
	let parts: string[];
	try {
		parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
	} catch {
		return null;
	}
	if (parts.length !== 3 || parts[0] !== "docs") {
		return null;
	}
	const [, corpus, collection] = parts;
	if (!(corpus && collection)) {
		return null;
	}
	return { collection, corpus };
}

export function buildCollectionNavigationUrl(input: CollectionRouteTarget): string {
	return `/api/docs/collections/${encodeURIComponent(input.corpus)}/${encodeURIComponent(
		input.collection,
	)}/navigation`;
}

function resolveFailureState(status: number): CollectionState {
	if (status === 401) {
		return { status: "unauthorized" };
	}
	if (status >= 500) {
		return { status: "unavailable" };
	}
	return { status: "not_found" };
}

function resolveLoginHref(): string {
	try {
		return buildAccountLoginUrlForCurrentRoute();
	} catch {
		return "/account/login";
	}
}
