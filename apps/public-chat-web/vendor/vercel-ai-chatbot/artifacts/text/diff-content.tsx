import { DiffView } from "@/components/chat/diffview";

export function TextArtifactDiffContent({
	newContent,
	oldContent,
}: {
	newContent: string;
	oldContent: string;
}) {
	return (
		<div className="flex flex-row px-4 py-8 md:px-16 md:py-12 lg:px-20">
			<DiffView newContent={newContent} oldContent={oldContent} />
		</div>
	);
}
