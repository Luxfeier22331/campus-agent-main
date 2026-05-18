import { DocumentSkeleton } from "@/components/chat/document-skeleton";
import { lazy, Suspense } from "react";
import type { SheetArtifactContentProps } from "./client";

const SheetArtifactEditor = lazy(async () => {
	const module = await import("./editor-content");
	return { default: module.SheetArtifactEditorContent };
});

export function SheetArtifactContent({
	content,
	currentVersionIndex,
	onSaveContent,
	status,
}: SheetArtifactContentProps) {
	return (
		<Suspense fallback={<DocumentSkeleton artifactKind="sheet" />}>
			<SheetArtifactEditor
				content={content}
				currentVersionIndex={currentVersionIndex}
				onSaveContent={onSaveContent}
				status={status}
			/>
		</Suspense>
	);
}
