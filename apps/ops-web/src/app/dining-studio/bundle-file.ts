import {
	canonicalizeDiningFloorplanBundle,
	type DiningFloorplanBundleV1,
	diagnoseDiningWayfindingLayout,
	serializeDiningFloorplanBundle,
} from "@campus-agent/dining/floorplans";
import { DINING_DRAFT_REQUEST_MAX_BYTES } from "../../shared/dining-contract";

export const DINING_FLOORPLAN_BUNDLE_MAX_BYTES = DINING_DRAFT_REQUEST_MAX_BYTES;
export const DINING_FLOORPLAN_BUNDLE_FILE_NAME = "dining-floorplans.bundle.v1.json";

export interface DiningFloorplanBundleSummary {
	halls: number;
	layouts: number;
	windows: number;
}

export function parseDiningFloorplanBundleText(text: string): DiningFloorplanBundleV1 {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error("地图 bundle 不是有效的 JSON 文件。");
	}
	try {
		const bundle = canonicalizeDiningFloorplanBundle(value);
		for (const layout of bundle.layouts) {
			const diagnostics = diagnoseDiningWayfindingLayout(layout);
			if (diagnostics.length > 0) {
				throw new Error(`${layout.label} 地图有 ${diagnostics.length} 个问题待处理。`);
			}
		}
		return bundle;
	} catch (error) {
		throw new Error(
			error instanceof Error ? `地图 bundle 无效：${error.message}` : "地图 bundle 无效。",
		);
	}
}

export async function readDiningFloorplanBundleFile(file: {
	name?: string;
	size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}): Promise<DiningFloorplanBundleV1> {
	if (file.size > DINING_FLOORPLAN_BUNDLE_MAX_BYTES) {
		throw new Error("地图 bundle 文件不能超过 8 MiB。");
	}
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
	} catch {
		throw new Error("地图 bundle 文件必须使用有效的 UTF-8 编码。");
	}
	return parseDiningFloorplanBundleText(text);
}

export function summarizeDiningFloorplanBundle(
	bundle: DiningFloorplanBundleV1,
): DiningFloorplanBundleSummary {
	return {
		halls: bundle.halls.length,
		layouts: bundle.layouts.length,
		windows: bundle.layouts.reduce((total, layout) => total + layout.windows.length, 0),
	};
}

export function downloadDiningFloorplanBundle(bundle: DiningFloorplanBundleV1): void {
	const blob = new Blob([serializeDiningFloorplanBundle(bundle)], {
		type: "application/json;charset=utf-8",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = DINING_FLOORPLAN_BUNDLE_FILE_NAME;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
