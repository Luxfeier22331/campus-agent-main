import { useEffect, useState } from "react";

import { buildAccountLoginUrlForCurrentRoute } from "@/platform/runtime/config";

interface DocsResolveResponse {
	document: {
		collection: string;
		corpus: string;
		documentSlug: string;
		title: string;
	};
	readerAsset: {
		contentUrl: string;
		deliveryMode: "gated_asset" | "public_static_asset";
		outlineUrl: string;
	};
	readerState: {
		anchor: string | null;
		highlightRootUnitIds: string[];
	};
	resolvedVersion: {
		label: string;
		versionSlug: string;
	};
}

interface ReaderPayload {
	document?: {
		title?: string;
	};
	sections?: Array<{
		anchor?: string;
		blocks?: Array<{
			kind?: string;
			rootUnitId?: string;
			text?: string;
		}>;
		title?: string;
	}>;
}

interface ReaderRouteTarget {
	anchor: string | null;
	collection: string;
	corpus: string;
	documentSlug: string;
	highlightRootUnitIds: string[];
	version: string | null;
}

type ReaderState =
	| { status: "loading" }
	| { status: "not_found" }
	| { status: "unauthorized" }
	| { status: "unavailable" }
	| { reader: ReaderPayload; resolve: DocsResolveResponse; status: "ready" };

export default function GatedReaderBootstrap() {
	const [state, setState] = useState<ReaderState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;

		async function loadReader() {
			const target = parseReaderRoute(window.location);
			if (!target) {
				setState({ status: "not_found" });
				return;
			}

			try {
				const resolveResponse = await fetch(buildResolveUrl(target), {
					credentials: "include",
					headers: { accept: "application/json" },
				});
				if (!resolveResponse.ok) {
					setState(resolveFailureState(resolveResponse.status));
					return;
				}

				const resolved = (await resolveResponse.json()) as DocsResolveResponse;
				const readerResponse = await fetch(resolved.readerAsset.contentUrl, {
					credentials: "include",
					headers: { accept: "application/json" },
				});
				if (!readerResponse.ok) {
					setState(resolveFailureState(readerResponse.status));
					return;
				}

				const reader = (await readerResponse.json()) as ReaderPayload;
				if (!cancelled) {
					setState({ reader, resolve: resolved, status: "ready" });
				}
			} catch {
				if (!cancelled) {
					setState({ status: "unavailable" });
				}
			}
		}

		void loadReader();
		return () => {
			cancelled = true;
		};
	}, []);

	if (state.status === "loading") {
		return <div className="reader-bootstrap-status">正在读取文档</div>;
	}
	if (state.status === "not_found") {
		return (
			<div className="reader-bootstrap-status">
				<h1>无法打开文档</h1>
				<p>请确认当前账号可以访问这份文档。</p>
			</div>
		);
	}
	if (state.status === "unauthorized") {
		return (
			<div className="reader-bootstrap-status">
				<h1>请先登录</h1>
				<p>登录后继续打开这份文档。</p>
				<a href={resolveLoginHref()}>登录后继续</a>
			</div>
		);
	}
	if (state.status === "unavailable") {
		return (
			<div className="reader-bootstrap-status">
				<h1>文档暂不可用</h1>
				<p>请稍后重试。</p>
			</div>
		);
	}

	const title = state.reader.document?.title || state.resolve.document.title;
	return (
		<article className="reader-bootstrap-article">
			<header
				className="document-meta-panel"
				data-docs-collection={state.resolve.document.collection}
				data-docs-corpus={state.resolve.document.corpus}
				data-docs-document-slug={state.resolve.document.documentSlug}
				data-docs-reader-meta="true"
				data-docs-version-slug={state.resolve.resolvedVersion.versionSlug}
			>
				<p className="document-meta-summary">
					<span>{state.resolve.resolvedVersion.label}</span>
					<span>
						{state.resolve.readerAsset.deliveryMode === "gated_asset" ? "需登录" : "公开"}
					</span>
				</p>
			</header>
			<h1>{title}</h1>
			{withStableKeys(state.reader.sections ?? [], resolveSectionKey).map(
				({ item: section, key }) => (
					<section key={key}>
						{section.anchor ? <span id={section.anchor} /> : null}
						{section.title && section.title !== title ? <h2>{section.title}</h2> : null}
						{withStableKeys(section.blocks ?? [], resolveBlockKey).map(({ item: block, key }) => (
							<div
								className={resolveBlockClassName(block.rootUnitId, state.resolve.readerState)}
								data-root-unit-id={block.rootUnitId}
								key={key}
							>
								{renderTextBlock(block.text ?? "")}
							</div>
						))}
					</section>
				),
			)}
		</article>
	);
}

function resolveFailureState(status: number): ReaderState {
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

function parseReaderRoute(location: Location): ReaderRouteTarget | null {
	let parts: string[];
	try {
		parts = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
	} catch {
		return null;
	}
	if (parts[0] !== "docs" || parts.length < 4) {
		return null;
	}
	const version = parts[4] === "v" ? (parts[5] ?? null) : null;
	return {
		anchor: location.hash ? decodeURIComponent(location.hash.slice(1)) : null,
		collection: parts[2],
		corpus: parts[1],
		documentSlug: parts[3],
		highlightRootUnitIds: parseHighlightRootUnitIds(new URLSearchParams(location.search).get("hl")),
		version,
	};
}

function buildResolveUrl(input: ReaderRouteTarget): string {
	const params = new URLSearchParams();
	if (input.version) {
		params.set("version", input.version);
	}
	if (input.anchor) {
		params.set("anchor", input.anchor);
	}
	if (input.highlightRootUnitIds.length > 0) {
		params.set("hl", input.highlightRootUnitIds.join(","));
	}
	const query = params.toString();
	return `/api/docs/collections/${encodeURIComponent(input.corpus)}/${encodeURIComponent(
		input.collection,
	)}/documents/${encodeURIComponent(input.documentSlug)}/resolve${query ? `?${query}` : ""}`;
}

function parseHighlightRootUnitIds(value: string | null): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function resolveBlockClassName(
	rootUnitId: string | undefined,
	readerState: DocsResolveResponse["readerState"],
): string {
	const classNames = ["reader-block"];
	if (rootUnitId && readerState.highlightRootUnitIds.includes(rootUnitId)) {
		classNames.push("docs-reader-highlight");
	}
	return classNames.join(" ");
}

function renderTextBlock(text: string) {
	return text.split(/\n{2,}/u).map((paragraph) => <p key={hashString(paragraph)}>{paragraph}</p>);
}

function resolveSectionKey(section: NonNullable<ReaderPayload["sections"]>[number]): string {
	return section.anchor || section.title || hashString(JSON.stringify(section));
}

function resolveBlockKey(
	block: NonNullable<NonNullable<ReaderPayload["sections"]>[number]["blocks"]>[number],
): string {
	return block.rootUnitId || hashString(`${block.kind ?? "block"}:${block.text ?? ""}`);
}

function withStableKeys<T>(
	items: readonly T[],
	resolveBaseKey: (item: T) => string,
): Array<{ item: T; key: string }> {
	const seen = new Map<string, number>();
	return items.map((item) => {
		const baseKey = resolveBaseKey(item) || "item";
		const count = seen.get(baseKey) ?? 0;
		seen.set(baseKey, count + 1);
		return { item, key: count === 0 ? baseKey : `${baseKey}-${count}` };
	});
}

function hashString(value: string): string {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) | 0;
	}
	return `h${Math.abs(hash).toString(36)}`;
}
