import { lazy, Suspense } from "react";
import type { ImageArtifactContentProps } from "./client";

const ImageArtifactContent = lazy(async () => {
	const module = await import("./content");
	return { default: module.ImageArtifactContent };
});

export function LazyImageArtifactContent(props: ImageArtifactContentProps) {
	return (
		<Suspense fallback={<div className="h-full w-full animate-pulse bg-muted/20" />}>
			<ImageArtifactContent {...props} />
		</Suspense>
	);
}
