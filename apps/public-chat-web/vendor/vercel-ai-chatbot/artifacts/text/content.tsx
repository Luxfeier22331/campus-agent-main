import { DocumentSkeleton } from "@/components/chat/document-skeleton";
import { lazy, Suspense } from "react";
import type { TextArtifactContentProps } from "./client";

const TextArtifactEditor = lazy(async () => {
	const module = await import("./editor-content");
	return { default: module.TextArtifactEditorContent };
});

const TextArtifactDiff = lazy(async () => {
	const module = await import("./diff-content");
	return { default: module.TextArtifactDiffContent };
});

export function TextArtifactContent({
	mode,
	status,
	content,
	isCurrentVersion,
	currentVersionIndex,
	onSaveContent,
	getDocumentContentById,
	isLoading,
	metadata,
}: TextArtifactContentProps) {
	if (isLoading) {
		return <DocumentSkeleton artifactKind="text" />;
	}

	if (mode === "diff") {
		const selectedContent = getDocumentContentById(currentVersionIndex);
		const prevContent =
			currentVersionIndex > 0
				? getDocumentContentById(currentVersionIndex - 1)
				: selectedContent;

		return (
			<Suspense fallback={<DocumentSkeleton artifactKind="text" />}>
				<TextArtifactDiff newContent={selectedContent} oldContent={prevContent} />
			</Suspense>
		);
	}

	return (
		<Suspense fallback={<DocumentSkeleton artifactKind="text" />}>
			<TextArtifactEditor
				content={content}
				currentVersionIndex={currentVersionIndex}
				isCurrentVersion={isCurrentVersion}
				onSaveContent={onSaveContent}
				status={status}
				suggestions={isCurrentVersion && metadata ? metadata.suggestions : []}
			/>
		</Suspense>
	);
}
