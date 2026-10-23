import type { DiningWayfindingDiagnostic } from "@campus-agent/dining/floorplans";
import { Button } from "@campus-agent/ui";
import type { Editor } from "tldraw";
import { diningShapeEntityId } from "./tldraw-shapes";

export function DiningEditorDiagnosticPanel(props: {
	diagnostics: readonly DiningWayfindingDiagnostic[];
	editor: Editor;
}) {
	return (
		<div className="editor-feedback-panels">
			<div className="diagnostic-panel" role="alert">
				<strong>当前地图需要修正</strong>
				{props.diagnostics.map((diagnostic) => (
					<Button
						variant="ghost"
						className="pointer-events-auto justify-start whitespace-normal rounded-none px-3 text-left text-danger"
						key={`${diagnostic.code}:${diagnostic.message}`}
						onClick={() => {
							const ids = diagnostic.entities.flatMap((entity) => {
								const shape = props.editor
									.getCurrentPageShapes()
									.find((candidate) => diningShapeEntityId(candidate) === entity.id);
								return shape ? [shape.id] : [];
							});
							if (ids.length > 0) {
								props.editor.select(...ids);
								props.editor.zoomToSelection({ animation: { duration: 180 } });
							}
						}}
						type="button"
					>
						{diagnostic.message}
					</Button>
				))}
			</div>
		</div>
	);
}
