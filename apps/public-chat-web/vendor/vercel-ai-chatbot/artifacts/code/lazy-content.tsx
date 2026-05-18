import { lazy, Suspense } from "react";
import type { CodeArtifactContentProps } from "./client";

const CodeArtifactContent = lazy(async () => {
	const module = await import("./content");
	return { default: module.CodeArtifactContent };
});

export function LazyCodeArtifactContent(props: CodeArtifactContentProps) {
	return (
		<Suspense fallback={<div className="h-full w-full animate-pulse bg-muted/20" />}>
			<CodeArtifactContent {...props} />
		</Suspense>
	);
}
