export interface DiningReferenceRect {
	height: number;
	width: number;
	x: number;
	y: number;
}

export interface DiningReferenceCalibration {
	floorId: string;
	layoutBounds: DiningReferenceRect;
	referenceId: string;
	sourceCrop: DiningReferenceRect;
	sourceSha256: `sha256:${string}`;
	sourceSize: { height: number; width: number };
}

export const DINING_REFERENCE_CALIBRATIONS = [
	{
		floorId: "fengtai-huixian-canteen-1f",
		layoutBounds: { height: 645, width: 861, x: 210, y: 50 },
		referenceId: "20260701-070840",
		sourceCrop: { height: 331, width: 429, x: 427, y: 344 },
		sourceSha256: "sha256:4352fa73dcd687db262edb99251956c3fab3069d63e862b42657a1375cc67504",
		sourceSize: { height: 1080, width: 1440 },
	},
	{
		floorId: "fengtai-huixian-canteen-2f",
		layoutBounds: { height: 660, width: 885, x: 198, y: 50 },
		referenceId: "20260701-070813",
		sourceCrop: { height: 387, width: 511, x: 436, y: 396 },
		sourceSha256: "sha256:f4109f52c5dea9c49a062bff2a82f985468fd18eae68c1610191e56a180601f8",
		sourceSize: { height: 1080, width: 1440 },
	},
	{
		floorId: "fengtai-juya-canteen-1f",
		layoutBounds: { height: 660, width: 670, x: 305, y: 50 },
		referenceId: "20260701-011942",
		sourceCrop: { height: 648, width: 655, x: 585, y: 232 },
		sourceSha256: "sha256:15fcdff2d4b572baba8c2b7e8040d7c1cd500dd2f8fb5c49e050cf8e0eda3553",
		sourceSize: { height: 1080, width: 1440 },
	},
	{
		floorId: "fengtai-juya-canteen-2f",
		layoutBounds: { height: 659, width: 660, x: 317, y: 50 },
		referenceId: "20260701-012002",
		sourceCrop: { height: 418, width: 432, x: 650, y: 327 },
		sourceSha256: "sha256:e472eaf3621d4ed4c834d1790117a5fc88e83d95477591d5152c264a0034691a",
		sourceSize: { height: 1080, width: 1440 },
	},
] as const satisfies readonly DiningReferenceCalibration[];

export function getDiningReferenceCalibration(floorId: string): DiningReferenceCalibration | null {
	return DINING_REFERENCE_CALIBRATIONS.find((item) => item.floorId === floorId) ?? null;
}
