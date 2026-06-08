import { Layer, Rect, Stage, Text } from "react-konva";
import type { DiningWindow } from "../../features/dining/model";

export function FloorplanCanvas(input: {
	onSelectWindow(windowId: string): void;
	selectedWindowId: string | null;
	windows: DiningWindow[];
}) {
	return (
		<div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
			<Stage height={420} width={720}>
				<Layer>
					<Rect fill="#f8fafc" height={420} width={720} x={0} y={0} />
					{input.windows.map((window) => {
						const selected = window.windowId === input.selectedWindowId;
						return (
							<Rect
								cornerRadius={4}
								fill={selected ? "#18181b" : "#ffffff"}
								height={window.geometry.height}
								key={window.windowId}
								onClick={() => input.onSelectWindow(window.windowId)}
								onTap={() => input.onSelectWindow(window.windowId)}
								stroke={selected ? "#18181b" : "#d4d4d8"}
								strokeWidth={1}
								width={window.geometry.width}
								x={window.geometry.x}
								y={window.geometry.y}
							/>
						);
					})}
					{input.windows.map((window) => {
						const selected = window.windowId === input.selectedWindowId;
						return (
							<Text
								fill={selected ? "#ffffff" : "#18181b"}
								fontFamily="Inter, system-ui, sans-serif"
								fontSize={13}
								key={`${window.windowId}:label`}
								listening={false}
								text={window.label}
								width={window.geometry.width - 20}
								x={window.geometry.x + 10}
								y={window.geometry.y + 24}
							/>
						);
					})}
				</Layer>
			</Stage>
		</div>
	);
}
