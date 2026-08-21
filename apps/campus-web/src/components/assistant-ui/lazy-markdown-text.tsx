import { lazy, Suspense } from "react";

const MarkdownText = lazy(() =>
	import("./markdown-text").then((module) => ({ default: module.MarkdownText })),
);

export function LazyMarkdownText() {
	return (
		<Suspense
			fallback={
				<span
					aria-hidden="true"
					className="inline-block h-4 w-24 animate-pulse rounded bg-surface-muted motion-reduce:animate-none"
				/>
			}
		>
			<MarkdownText />
		</Suspense>
	);
}
