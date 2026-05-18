import { SpreadsheetEditor } from "@/components/chat/sheet-editor";

export function SheetArtifactEditorContent({
	content,
	currentVersionIndex,
	onSaveContent,
	status,
}: {
	content: string;
	currentVersionIndex: number;
	onSaveContent: (updatedContent: string, debounce: boolean) => void;
	status: "streaming" | "idle";
}) {
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
