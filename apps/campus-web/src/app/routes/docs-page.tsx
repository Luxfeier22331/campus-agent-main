import { useLocation } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ErrorPanel, LoadingPanel } from "@/components/shell/state-panels";
import { SupportSurfaceShell } from "@/components/shell/support-surface-shell";
import { Card } from "@/components/ui/card";
import { resolveDocument } from "@/features/docs/api";
import type { DocsResolveResponse } from "@/features/docs/model";
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
	const [document, setDocument] = useState<DocsResolveResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		resolveDocument({
			anchor: routeParts.readerState.anchor,
			...routeParts,
			documentSlug: routeParts.documentSlug,
			highlightRootUnitIds: routeParts.readerState.highlightRootUnitIds,
			versionSlug: routeParts.versionSlug,
		})
			.then((nextDocument) => {
				if (cancelled) {
					return;
				}
				setDocument(nextDocument);
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
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

	return (
		<SupportSurfaceShell
			className="max-w-[960px]"
			contentClassName="grid place-items-start"
			eyebrow="校园文档"
			title="文档"
		>
			{error ? (
				<ErrorPanel message={error} />
			) : (
				<Card className="w-full max-w-2xl p-5">
					<p className="text-sm font-medium text-[var(--sys-text-muted)]">正在打开文档</p>
					{loading || !document ? (
						<div className="mt-4">
							<LoadingPanel label="正在准备文档" />
						</div>
					) : (
						<ReaderHandoff document={document} readerState={routeParts.readerState} />
					)}
				</Card>
			)}
		</SupportSurfaceShell>
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
			<a
				className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white"
				href={readerHref}
			>
				继续打开
				<ExternalLink aria-hidden="true" className="size-4" />
			</a>
		</>
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
