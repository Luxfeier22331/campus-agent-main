import { Editor } from "@/components/chat/text-editor";
import type { Suggestion } from "@/lib/db/schema";

export function TextArtifactEditorContent({
	content,
	currentVersionIndex,
	isCurrentVersion,
	onSaveContent,
	status,
	suggestions,
}: {
	content: string;
	currentVersionIndex: number;
	isCurrentVersion: boolean;
	onSaveContent: (updatedContent: string, debounce: boolean) => void;
	status: "streaming" | "idle";
	suggestions: Suggestion[];
}) {
	return (
		<div className="flex flex-row px-4 py-8 md:px-16 md:py-12 lg:px-20">
			<Editor
				content={content}
				currentVersionIndex={currentVersionIndex}
				isCurrentVersion={isCurrentVersion}
				onSaveContent={onSaveContent}
				status={status}
				suggestions={suggestions}
			/>

			{suggestions.length > 0 ? <div className="h-dvh w-12 shrink-0 md:hidden" /> : null}
		</div>
	);
}
