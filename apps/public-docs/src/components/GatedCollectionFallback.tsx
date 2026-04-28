import { useEffect, useState } from "react";

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
	| { navigation: DocsNavigationResponse; status: "ready" };

export default function GatedCollectionFallback() {
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
					setState({ status: "not_found" });
					return;
				}

				const navigation = (await response.json()) as DocsNavigationResponse;
				if (!cancelled) {
					setState({ navigation, status: "ready" });
				}
			} catch {
				if (!cancelled) {
					setState({ status: "not_found" });
				}
			}
		}

		void loadCollection();
		return () => {
			cancelled = true;
		};
	}, []);

	if (state.status === "loading") {
		return <div className="reader-fallback-status">正在读取文档目录...</div>;
	}
	if (state.status === "not_found") {
		return (
			<div className="reader-fallback-status">
				<h1>未找到或无权访问该文档目录</h1>
				<p>请确认你已使用具备访问权限的校园身份登录。</p>
			</div>
		);
	}

	const { collection, nodes } = state.navigation;
	return (
		<article className="reader-fallback-article gated-collection-fallback">
			<header className="document-meta-panel">
				<p className="document-meta-summary">
					<span>{collection.displayName}</span>
					<span>受限文档目录</span>
				</p>
				{collection.description ? <p>{collection.description}</p> : null}
			</header>
			<h1>{collection.displayName}</h1>
			{nodes.length > 0 ? (
				<ul className="gated-collection-list">
					{nodes.map((node) => (
						<li key={node.documentSlug}>
							<a href={node.canonicalUrl}>{node.title}</a>
						</li>
					))}
				</ul>
			) : (
				<p className="gated-collection-empty">
					当前身份下没有可访问的文档，或该集合尚未发布当前版本。
				</p>
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
