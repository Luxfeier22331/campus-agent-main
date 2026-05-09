import { SpreadsheetEditor } from "@/components/chat/sheet-editor";
import type { SheetArtifactContentProps } from "./client";

export function SheetArtifactContent({
	content,
	currentVersionIndex,
	onSaveContent,
	status,
}: SheetArtifactContentProps) {
	return (
		<SpreadsheetEditor
			content={content}
			currentVersionIndex={currentVersionIndex}
			isCurrentVersion={true}
			saveContent={onSaveContent}
			status={status}
		/>
	);
}
