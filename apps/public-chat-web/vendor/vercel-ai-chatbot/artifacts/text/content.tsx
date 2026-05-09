import { DiffView } from "@/components/chat/diffview";
import { DocumentSkeleton } from "@/components/chat/document-skeleton";
import { Editor } from "@/components/chat/text-editor";
import type { TextArtifactContentProps } from "./client";

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
			<div className="flex flex-row px-4 py-8 md:px-16 md:py-12 lg:px-20">
				<DiffView newContent={selectedContent} oldContent={prevContent} />
			</div>
		);
	}

	return (
		<div className="flex flex-row px-4 py-8 md:px-16 md:py-12 lg:px-20">
			<Editor
				content={content}
				currentVersionIndex={currentVersionIndex}
				isCurrentVersion={isCurrentVersion}
				onSaveContent={onSaveContent}
				status={status}
				suggestions={isCurrentVersion && metadata ? metadata.suggestions : []}
			/>

			{metadata?.suggestions && metadata.suggestions.length > 0 ? (
				<div className="h-dvh w-12 shrink-0 md:hidden" />
			) : null}
		</div>
	);
}
