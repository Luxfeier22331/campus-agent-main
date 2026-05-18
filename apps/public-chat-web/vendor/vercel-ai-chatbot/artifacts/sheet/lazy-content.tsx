import { lazy, Suspense } from "react";
import type { SheetArtifactContentProps } from "./client";

const SheetArtifactContent = lazy(async () => {
	const module = await import("./content");
	return { default: module.SheetArtifactContent };
});

export function LazySheetArtifactContent(props: SheetArtifactContentProps) {
	return (
		<Suspense fallback={<div className="h-full w-full animate-pulse bg-muted/20" />}>
			<SheetArtifactContent {...props} />
		</Suspense>
	);
}
