export type StructuralFloorplanRectClass = "core" | "service" | "stair";

export interface StructuralFloorplanRect {
	className: StructuralFloorplanRectClass;
	height: number;
	width: number;
	x: number;
	y: number;
}

export interface StructuralFloorplanWindow {
	anchorId: string;
	height: number;
	label: string;
	width: number;
	x: number;
	y: number;
}

export interface StructuralFloorplanEntrance {
	height: number;
	label?: string;
	width: number;
	x: number;
	y: number;
}

export interface StructuralFloorplanShape<FloorId extends string = string> {
	circulation?: string[];
	entrances?: StructuralFloorplanEntrance[];
	floorId: FloorId;
	outerShell: string;
	rects: StructuralFloorplanRect[];
	title: string;
	walls: string[];
	windows: StructuralFloorplanWindow[];
}

export function renderStructuralFloorplan(input: StructuralFloorplanShape): string {
	const circulation = (input.circulation ?? [])
		.map(
			(path) =>
				`<path class="circulation" d="${path}"/><path class="circulation-line" d="${path}"/>`,
		)
		.join("");
	const walls = input.walls.map((path) => `<path class="wall" d="${path}"/>`).join("");
	const rects = input.rects
		.map(
			(rect) =>
				`<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" class="${rect.className}"/>`,
		)
		.join("");
	const entrances = (input.entrances ?? []).map(renderEntrance).join("");
	const windows = input.windows.map(renderWindowAnchor).join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 760" role="img" aria-label="${input.title}" data-dining-floor-id="${input.floorId}"><title>${input.title}</title><desc>可点击食堂结构示意，不包含原始照片。</desc><defs><style>text{font-family:"Noto Sans CJK SC","Microsoft YaHei",Arial,sans-serif}.outer-wall,.wall,.core,.service,.stair,.window-hit,.entrance-line,.circulation,.circulation-line{vector-effect:non-scaling-stroke}.floor-bg{fill:#fbfaf7}.outer-wall{fill:#f3f6f2;stroke:#27364a;stroke-width:6;stroke-linejoin:round}.wall{fill:none;stroke:#42526b;stroke-width:3.6;stroke-linecap:square;stroke-linejoin:round}.core{fill:#eef2f6;stroke:#7b8797;stroke-width:2.4}.service{fill:#e9eef2;stroke:#7b8797;stroke-width:2.4}.stair{fill:#e5ece7;stroke:#7b8797;stroke-width:2.4}.circulation{fill:none;stroke:#d8c7a4;stroke-width:13;stroke-linecap:round;stroke-linejoin:round;opacity:.42}.circulation-line{fill:none;stroke:#aa9a72;stroke-width:2.2;stroke-dasharray:10 12;stroke-linecap:round;opacity:.58}.entrance-line{stroke:#7b8797;stroke-width:4;stroke-linecap:round}.entrance-text{fill:#667085;font-size:14px;font-weight:650}.window-hit{fill:#fffef9;stroke:#94a3b8;stroke-width:2.4}.window-text{fill:#26374b;font-size:15px;font-weight:700}</style></defs><rect width="1280" height="760" class="floor-bg"/><g data-structure="floorplan-walls"><path class="outer-wall" d="${input.outerShell}"/>${circulation}${walls}${rects}${entrances}</g>${windows}</svg>`;
}

function renderEntrance(input: StructuralFloorplanEntrance): string {
	const label = input.label ?? "入口";
	const y = input.y + input.height / 2;
	return `<g data-map-role="entrance"><path d="M${input.x} ${y}H${input.x + input.width}" class="entrance-line"/><text x="${input.x + input.width / 2}" y="${input.y + input.height + 18}" text-anchor="middle" class="entrance-text">${label}</text></g>`;
}

function renderWindowAnchor(input: StructuralFloorplanWindow): string {
	return `<g data-dining-role="window" data-dining-anchor-id="${input.anchorId}" data-dining-label="${input.label}"><rect x="${input.x}" y="${input.y}" width="${input.width}" height="${input.height}" rx="9" class="window-hit"/><text x="${input.x + input.width / 2}" y="${input.y + input.height / 2 + 5}" text-anchor="middle" class="window-text">${input.label}</text></g>`;
}
