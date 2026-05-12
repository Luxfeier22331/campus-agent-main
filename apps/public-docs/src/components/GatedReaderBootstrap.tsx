import { useEffect, useState } from "react";

interface DocsResolveResponse {
	document: {
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
	| { status: "ready"; reader: ReaderPayload; resolve: DocsResolveResponse };

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
					setState({ status: "not_found" });
					return;
				}

				const resolved = (await resolveResponse.json()) as DocsResolveResponse;
				const readerResponse = await fetch(resolved.readerAsset.contentUrl, {
					credentials: "include",
					headers: { accept: "application/json" },
				});
				if (!readerResponse.ok) {
					setState({ status: "not_found" });
					return;
				}

				const reader = (await readerResponse.json()) as ReaderPayload;
				if (!cancelled) {
					setState({ status: "ready", reader, resolve: resolved });
				}
			} catch {
				if (!cancelled) {
					setState({ status: "not_found" });
				}
			}
		}

		void loadReader();
		return () => {
			cancelled = true;
		};
	}, []);

	if (state.status === "loading") {
		return <div className="reader-bootstrap-status">正在读取文档...</div>;
	}
	if (state.status === "not_found") {
		return (
			<div className="reader-bootstrap-status">
				<h1>未找到或无权访问该文档</h1>
				<p>请确认你已使用具备访问权限的校园身份登录。</p>
			</div>
		);
	}

	const title = state.reader.document?.title || state.resolve.document.title;
	return (
		<article className="reader-bootstrap-article">
			<header className="document-meta-panel">
				<div className="document-meta-summary">
					<span>{state.resolve.resolvedVersion.label}</span>
					<span>
						{state.resolve.readerAsset.deliveryMode === "gated_asset" ? "受限文档" : "公开文档"}
					</span>
				</div>
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

function parseReaderRoute(location: Location): ReaderRouteTarget | null {
	const parts = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
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
		classNames.push("reader-block-highlight");
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
