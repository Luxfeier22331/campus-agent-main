import { lazy, Suspense } from "react";
import type { TextArtifactContentProps } from "./client";

const TextArtifactContent = lazy(async () => {
	const module = await import("./content");
	return { default: module.TextArtifactContent };
});

export function LazyTextArtifactContent(props: TextArtifactContentProps) {
	return (
		<Suspense fallback={<div className="h-full w-full animate-pulse bg-muted/20" />}>
			<TextArtifactContent {...props} />
		</Suspense>
	);
}
