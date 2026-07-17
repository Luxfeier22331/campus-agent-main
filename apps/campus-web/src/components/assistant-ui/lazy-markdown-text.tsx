import { lazy, Suspense } from "react";

const MarkdownText = lazy(() =>
	import("./markdown-text").then((module) => ({ default: module.MarkdownText })),
);

export function LazyMarkdownText() {
	return (
		<Suspense fallback={<span className="text-muted-foreground text-sm">正在整理回答</span>}>
			<MarkdownText />
		</Suspense>
	);
}
