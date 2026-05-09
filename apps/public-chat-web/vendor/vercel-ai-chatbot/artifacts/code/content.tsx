import { CodeEditor } from "@/components/chat/code-editor";
import { Console } from "@/components/chat/console";
import type { CodeArtifactContentProps } from "./client";

export function CodeArtifactContent({ metadata, setMetadata, ...props }: CodeArtifactContentProps) {
	return (
		<>
			<div className="relative min-h-[200px]">
				<CodeEditor {...props} />
			</div>

			{metadata?.outputs && (
				<Console
					consoleOutputs={metadata.outputs}
					setConsoleOutputs={() => {
						setMetadata({
							...metadata,
							outputs: [],
						});
					}}
				/>
			)}
		</>
	);
}
