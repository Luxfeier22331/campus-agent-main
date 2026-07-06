import { XMLBuilder, XMLParser } from "fast-xml-parser";

import { haidianErSiFloorplanInput } from "./haidian-er-si-floorplans";
import { huixianFloorplanInput } from "./huixian-floorplans";
import { juyaFloorplanInput } from "./juya-floorplans";

export type DiningFloorplanAnchorRole = "window" | "region" | "entrance" | "seat" | "service";

export interface DiningFloorplanAnchor {
	anchorId: string;
	label?: string;
	role: DiningFloorplanAnchorRole;
}

export interface DiningFloorplanManifestEntry {
	anchorInventory: DiningFloorplanAnchor[];
	floorId: string;
	floorplanId: string;
	hallId: string;
	sha256: `sha256:${string}`;
	svgAssetUrl: string;
	svgMarkup: string;
}

export interface DiningFloorplanManifestInput {
	anchorInventory?: DiningFloorplanAnchor[];
	floorId: string;
	floorplanId: string;
	hallId: string;
	sha256: `sha256:${string}`;
	svgAssetUrl: string;
	svgMarkup: string;
}

const XML_OPTIONS = {
	attributeNamePrefix: "@_",
	ignoreAttributes: false,
	preserveOrder: false,
} as const;

const FORBIDDEN_TAGS = new Set(["foreignObject", "iframe", "script"]);
const ALLOWED_ANCHOR_ROLES = new Set<DiningFloorplanAnchorRole>([
	"window",
	"region",
	"entrance",
	"seat",
	"service",
]);

const FENGTAI_OUTDOOR_DINING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1050" role="img" aria-label="丰台露天餐饮区平面图" data-dining-floor-id="fengtai-outdoor-dining-zone-ground"><title>丰台露天餐饮区平面图</title><desc>丰台校区露天餐饮区的商铺、临时摊位、就餐区、通道和出入口示意图。</desc><defs><style>text{font-family:"Noto Sans CJK SC","Microsoft YaHei",Arial,sans-serif}.label{fill:#334155;font-size:24px;font-weight:700}.meta{fill:#64748b;font-size:17px;font-weight:500}.zone-label{fill:#475569;font-size:28px;font-weight:750}.anchor-card{fill:#fbfbf8;stroke:#c6d0db;stroke-width:3}.anchor-badge{fill:#eef4f2;stroke:#9eb8b0;stroke-width:2}.temporary-card{fill:#f8fafc;stroke:#c2ceda}.seating{fill:#f6f1e8;stroke:#d1bfa5}.path-line{fill:none;stroke:#a8b3c0;stroke-width:4;stroke-linecap:round;stroke-dasharray:12 14}</style><marker id="flow-arrow" markerHeight="10" markerWidth="10" orient="auto" refX="8" refY="5"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#a8b3c0"/></marker></defs><rect width="1600" height="1050" fill="#f6f8f7"/><rect x="48" y="44" width="1504" height="960" rx="28" fill="#ffffff" stroke="#d9e0e6" stroke-width="2"/><text x="96" y="104" class="label">丰台露天餐饮区</text><text x="96" y="140" class="meta">商铺、临时摊位、就餐区与出入口示意</text><text x="1452" y="116" fill="#64748b" font-size="20" font-weight="650" text-anchor="middle">北</text><path d="M1452 138 L1435 180 L1452 169 L1469 180 Z" fill="#64748b"/><rect x="92" y="176" width="1416" height="760" rx="26" fill="#fbfcfb" stroke="#cbd5df" stroke-width="3"/><path d="M 138 224 L 1348 224 L 1348 868 L 138 868 Z" fill="none" stroke="#94a3b8" stroke-width="5" stroke-linejoin="round"/><rect x="1112" y="254" width="190" height="560" rx="20" fill="#f5f7f8" stroke="#d7dee6" stroke-width="2" stroke-dasharray="12 12"/><text x="1207" y="540" class="meta" text-anchor="middle" transform="rotate(90 1207 540)">右侧通道</text><g id="shop-01-maituanxiong" data-dining-role="window" data-dining-anchor-id="shop-01-maituanxiong" data-dining-label="麦团熊"><rect x="258" y="260" width="210" height="94" rx="18" class="anchor-card"/><circle cx="302" cy="307" r="24" class="anchor-badge"/><text x="302" y="315" fill="#475569" font-size="19" font-weight="800" text-anchor="middle">01</text><text x="342" y="316" class="label">麦团熊</text></g><g id="shop-02-zuozuoxiang" data-dining-role="window" data-dining-anchor-id="shop-02-zuozuoxiang" data-dining-label="左左香"><rect x="514" y="260" width="210" height="94" rx="18" class="anchor-card"/><circle cx="558" cy="307" r="24" class="anchor-badge"/><text x="558" y="315" fill="#475569" font-size="19" font-weight="800" text-anchor="middle">02</text><text x="598" y="316" class="label">左左香</text></g><g id="shop-03-tastien" data-dining-role="window" data-dining-anchor-id="shop-03-tastien" data-dining-label="塔斯汀"><rect x="770" y="260" width="210" height="94" rx="18" class="anchor-card"/><circle cx="814" cy="307" r="24" class="anchor-badge"/><text x="814" y="315" fill="#475569" font-size="19" font-weight="800" text-anchor="middle">03</text><text x="854" y="316" class="label">塔斯汀</text></g><g id="shop-04-huihan-zhachuan" data-dining-role="window" data-dining-anchor-id="shop-04-huihan-zhachuan" data-dining-label="会汉炸串"><rect x="158" y="258" width="94" height="220" rx="18" class="anchor-card"/><circle cx="205" cy="302" r="23" class="anchor-badge"/><text x="205" y="310" fill="#475569" font-size="18" font-weight="800" text-anchor="middle">04</text><text x="205" y="365" class="label" text-anchor="middle"><tspan x="205" dy="-18">会</tspan><tspan x="205" dy="30">汉</tspan><tspan x="205" dy="30">炸</tspan><tspan x="205" dy="30">串</tspan></text></g><g id="shop-05-luckin-jixiang-huntun" data-dining-role="window" data-dining-anchor-id="shop-05-luckin-jixiang-huntun" data-dining-label="瑞幸咖啡 / 吉祥馄饨"><rect x="158" y="646" width="210" height="160" rx="18" class="anchor-card"/><circle cx="202" cy="690" r="23" class="anchor-badge"/><text x="202" y="698" fill="#475569" font-size="18" font-weight="800" text-anchor="middle">05</text><text x="270" y="728" class="label" text-anchor="middle"><tspan x="270" dy="-18">瑞幸咖啡</tspan><tspan x="270" dy="34">吉祥馄饨</tspan></text></g><g id="shop-06-lage-lamei" data-dining-role="window" data-dining-anchor-id="shop-06-lage-lamei" data-dining-label="辣哥辣妹"><rect x="382" y="758" width="240" height="94" rx="18" class="anchor-card"/><circle cx="426" cy="805" r="24" class="anchor-badge"/><text x="426" y="813" fill="#475569" font-size="19" font-weight="800" text-anchor="middle">06</text><text x="466" y="814" class="label">辣哥辣妹</text></g><g id="shop-07-ice-snacks" data-dining-role="window" data-dining-anchor-id="shop-07-ice-snacks" data-dining-label="冰品小吃"><rect x="662" y="758" width="218" height="94" rx="18" class="anchor-card"/><circle cx="706" cy="805" r="24" class="anchor-badge"/><text x="706" y="813" fill="#475569" font-size="19" font-weight="800" text-anchor="middle">07</text><text x="746" y="805" class="label">冰品小吃</text><text x="746" y="833" class="meta">冷饮与小食</text></g><g id="shop-08-guizhou-snacks" data-dining-role="window" data-dining-anchor-id="shop-08-guizhou-snacks" data-dining-label="贵州小吃"><rect x="920" y="758" width="250" height="94" rx="18" class="anchor-card"/><circle cx="964" cy="805" r="24" class="anchor-badge"/><text x="964" y="813" fill="#475569" font-size="19" font-weight="800" text-anchor="middle">08</text><text x="1004" y="814" class="label">贵州小吃</text></g><g id="stall-water-bar" data-dining-role="window" data-dining-anchor-id="stall-water-bar" data-dining-label="水吧"><rect x="704" y="414" width="104" height="58" rx="14" class="temporary-card" stroke-width="3"/><text x="756" y="452" class="label" text-anchor="middle">水吧</text></g><g id="stall-fruit" data-dining-role="window" data-dining-anchor-id="stall-fruit" data-dining-label="水果"><rect x="704" y="494" width="104" height="58" rx="14" class="temporary-card" stroke-width="3"/><text x="756" y="532" class="label" text-anchor="middle">水果</text></g><g id="stall-light-food" data-dining-role="window" data-dining-anchor-id="stall-light-food" data-dining-label="轻食"><rect x="704" y="574" width="104" height="58" rx="14" class="temporary-card" stroke-width="3"/><text x="756" y="612" class="label" text-anchor="middle">轻食</text></g><g id="seating-a"><rect x="322" y="412" width="312" height="214" rx="24" class="seating" stroke-width="3"/><text x="478" y="480" class="zone-label" text-anchor="middle">就餐区 A</text><rect x="380" y="522" width="74" height="26" rx="8" fill="#eadcc8" stroke="#d5c0a6"/><rect x="503" y="522" width="74" height="26" rx="8" fill="#eadcc8" stroke="#d5c0a6"/><rect x="380" y="570" width="74" height="26" rx="8" fill="#eadcc8" stroke="#d5c0a6"/><rect x="503" y="570" width="74" height="26" rx="8" fill="#eadcc8" stroke="#d5c0a6"/></g><g id="seating-b"><rect x="890" y="420" width="174" height="206" rx="24" class="seating" stroke-width="3"/><text x="977" y="492" class="zone-label" text-anchor="middle">就餐区 B</text><rect x="923" y="545" width="48" height="22" rx="7" fill="#eadcc8" stroke="#d5c0a6"/><rect x="987" y="545" width="48" height="22" rx="7" fill="#eadcc8" stroke="#d5c0a6"/><rect x="923" y="586" width="48" height="22" rx="7" fill="#eadcc8" stroke="#d5c0a6"/><rect x="987" y="586" width="48" height="22" rx="7" fill="#eadcc8" stroke="#d5c0a6"/></g><line x1="360" y1="684" x2="656" y2="684" class="path-line" marker-end="url(#flow-arrow)"/><line x1="824" y1="684" x2="1110" y2="684" class="path-line" marker-end="url(#flow-arrow)"/><line x1="662" y1="386" x2="662" y2="744" class="path-line" marker-end="url(#flow-arrow)"/><text x="518" y="720" class="meta" text-anchor="middle">主通道</text><text x="642" y="606" class="meta" text-anchor="middle" transform="rotate(90 642 606)">主通道</text><g id="entrance-southwest"><rect x="186" y="852" width="86" height="34" rx="6" fill="#ffffff" stroke="#94a3b8" stroke-width="2"/><line x1="229" y1="920" x2="229" y2="892" class="path-line" marker-end="url(#flow-arrow)"/><text x="229" y="942" class="meta" text-anchor="middle">出入口</text></g><g id="entrance-east"><rect x="1326" y="332" width="86" height="34" rx="6" fill="#ffffff" stroke="#94a3b8" stroke-width="2"/><line x1="1464" y1="349" x2="1418" y2="349" class="path-line" marker-end="url(#flow-arrow)"/><text x="1476" y="356" class="meta">出入口</text></g><g id="entrance-southeast"><rect x="1280" y="852" width="86" height="34" rx="6" fill="#ffffff" stroke="#94a3b8" stroke-width="2"/><line x1="1323" y1="920" x2="1323" y2="892" class="path-line" marker-end="url(#flow-arrow)"/><text x="1323" y="942" class="meta" text-anchor="middle">出入口</text></g><g id="legend"><rect x="112" y="944" width="16" height="16" rx="4" class="anchor-card"/><text x="140" y="958" class="meta">餐饮商铺 / 摊位</text><rect x="306" y="944" width="16" height="16" rx="4" class="seating"/><text x="334" y="958" class="meta">就餐区</text><line x1="430" y1="952" x2="486" y2="952" class="path-line"/><text x="500" y="958" class="meta">主通道</text></g></svg>`;

const STANDARD_WINDOW_ANCHORS: DiningFloorplanAnchor[] = [
	{ anchorId: "window-01", label: "一号窗口", role: "window" },
	{ anchorId: "window-02", label: "二号窗口", role: "window" },
	{ anchorId: "window-03", label: "三号窗口", role: "window" },
	{ anchorId: "window-04", label: "四号窗口", role: "window" },
	{ anchorId: "window-05", label: "五号窗口", role: "window" },
];

const STANDARD_DINING_FLOORPLAN_INPUTS: DiningFloorplanManifestInput[] = [
	standardFloorplanInput(
		"haidian-canteen-1",
		"haidian-canteen-1-1f",
		"海淀一食堂一层",
		"sha256:c55f08aa63157e174970361c07811678f54727179b317901c20b1b2f25df6929",
	),
	haidianErSiFloorplanInput({
		floorId: "haidian-canteen-2",
		sha256: "sha256:e89bcd21875064f370b99b3caac118164b07582240852204e2b60647ca558660",
	}),
	standardFloorplanInput(
		"haidian-canteen-3",
		"haidian-canteen-3-1f",
		"海淀三食堂一层",
		"sha256:101f5eb0c47e57eb5e9ba66911b1be8a899385bbe98a96054fdfc1fd1443ca92",
	),
	haidianErSiFloorplanInput({
		floorId: "haidian-canteen-4",
		sha256: "sha256:a1464e58196fc309cdb285a9192e9de4a1552850c3c8a129bb6e119d8382d160",
	}),
	standardFloorplanInput(
		"haidian-canteen-5",
		"haidian-canteen-5-1f",
		"海淀五食堂一层",
		"sha256:03a9147730d2a50216ff088a16aa004777def77e499074d375d9d0e56fcff158",
	),
	huixianFloorplanInput({
		floorId: "fengtai-huixian-canteen-1f",
		label: "荟贤食堂一层",
		sha256: "sha256:d5af2f44ac03d509f549efdb689c665b9f4dc54541dbd14c842f3ca839f016d6",
	}),
	huixianFloorplanInput({
		floorId: "fengtai-huixian-canteen-2f",
		label: "荟贤食堂二层",
		sha256: "sha256:25ba425130f907bf36f9e9057cf2509f77657ee299ccc38e2b724777680e54bf",
	}),
	juyaFloorplanInput({
		floorId: "fengtai-juya-canteen-1f",
		label: "聚雅食堂一层",
		sha256: "sha256:ebd31eb18c4e2fcb369e62dcec60839739d0fea057ebe33a73fedf504dac71dc",
	}),
	juyaFloorplanInput({
		floorId: "fengtai-juya-canteen-2f",
		label: "聚雅食堂二层",
		sha256: "sha256:3d4addafb614b95f11714d1356fbc8312aa960fdf3ea34e1576d5cc4a78ee72a",
	}),
];

export const DINING_FLOORPLAN_MANIFEST = [
	createManifestEntry({
		anchorInventory: [
			{ anchorId: "shop-01-maituanxiong", label: "麦团熊", role: "window" },
			{ anchorId: "shop-02-zuozuoxiang", label: "左左香", role: "window" },
			{ anchorId: "shop-03-tastien", label: "塔斯汀", role: "window" },
			{ anchorId: "shop-04-huihan-zhachuan", label: "会汉炸串", role: "window" },
			{
				anchorId: "shop-05-luckin-jixiang-huntun",
				label: "瑞幸咖啡 / 吉祥馄饨",
				role: "window",
			},
			{ anchorId: "shop-06-lage-lamei", label: "辣哥辣妹", role: "window" },
			{ anchorId: "shop-07-ice-snacks", label: "冰品小吃", role: "window" },
			{ anchorId: "shop-08-guizhou-snacks", label: "贵州小吃", role: "window" },
			{ anchorId: "stall-water-bar", label: "水吧", role: "window" },
			{ anchorId: "stall-fruit", label: "水果", role: "window" },
			{ anchorId: "stall-light-food", label: "轻食", role: "window" },
		],
		floorId: "fengtai-outdoor-dining-zone-ground",
		floorplanId: "floorplan:fengtai-outdoor-dining-zone:fengtai-outdoor-dining-zone-ground",
		hallId: "fengtai-outdoor-dining-zone",
		sha256: "sha256:3164ed6b086765a912855b933115c11ef1addcb2a840eeade2cbf8990fc99aad",
		svgAssetUrl: "/assets/dining/fengtai-outdoor-dining-zone.svg",
		svgMarkup: FENGTAI_OUTDOOR_DINING_SVG,
	}),
	...STANDARD_DINING_FLOORPLAN_INPUTS.map(createManifestEntry),
] satisfies DiningFloorplanManifestEntry[];

export function getDiningFloorplanByFloor(input: {
	floorId: string;
	hallId: string;
}): DiningFloorplanManifestEntry {
	const match = DINING_FLOORPLAN_MANIFEST.find(
		(entry) => entry.hallId === input.hallId && entry.floorId === input.floorId,
	);
	if (!match) {
		throw new Error(`Dining floorplan manifest entry not found: ${input.hallId}/${input.floorId}`);
	}
	return match;
}

export function assertDiningFloorplanManifest(
	entries: readonly DiningFloorplanManifestInput[],
): void {
	const seenFloorKeys = new Set<string>();
	const seenFloorplanIds = new Set<string>();

	for (const entry of entries) {
		assertRequiredManifestFields(entry);

		const floorKey = `${entry.hallId}/${entry.floorId}`;
		if (seenFloorKeys.has(floorKey)) {
			throw new Error(`Duplicate dining floorplan floor key: ${floorKey}`);
		}
		seenFloorKeys.add(floorKey);

		if (seenFloorplanIds.has(entry.floorplanId)) {
			throw new Error(`Duplicate dining floorplan id: ${entry.floorplanId}`);
		}
		seenFloorplanIds.add(entry.floorplanId);

		const sanitizedSvgMarkup = sanitizeSvgMarkup(entry.svgMarkup);
		const extractedAnchors = extractDiningSvgAnchors(sanitizedSvgMarkup);
		if (extractedAnchors.length === 0) {
			throw new Error(`Dining SVG has no data-dining-anchor-id: ${entry.floorplanId}`);
		}

		if (entry.anchorInventory) {
			assertAnchorInventoryMatchesSvg({
				anchorInventory: entry.anchorInventory,
				extractedAnchors,
				floorplanId: entry.floorplanId,
			});
		}

		if (!/^sha256:[0-9a-f]{64}$/.test(entry.sha256)) {
			throw new Error(`Dining floorplan sha256 is invalid: ${entry.floorplanId}`);
		}
	}
}

function createManifestEntry(input: DiningFloorplanManifestInput): DiningFloorplanManifestEntry {
	const sanitizedSvgMarkup = sanitizeSvgMarkup(input.svgMarkup);
	const extractedAnchors = extractDiningSvgAnchors(sanitizedSvgMarkup);
	const anchorInventory = input.anchorInventory ?? extractedAnchors;
	assertAnchorInventoryMatchesSvg({
		anchorInventory,
		extractedAnchors,
		floorplanId: input.floorplanId,
	});
	assertDiningFloorplanManifest([{ ...input, anchorInventory, svgMarkup: sanitizedSvgMarkup }]);
	return {
		anchorInventory,
		floorId: input.floorId,
		floorplanId: input.floorplanId,
		hallId: input.hallId,
		sha256: input.sha256,
		svgAssetUrl: input.svgAssetUrl,
		svgMarkup: sanitizedSvgMarkup,
	};
}

function standardFloorplanInput(
	hallId: string,
	floorId: string,
	label: string,
	sha256: `sha256:${string}`,
): DiningFloorplanManifestInput {
	return {
		anchorInventory: STANDARD_WINDOW_ANCHORS,
		floorId,
		floorplanId: `floorplan:${hallId}:${floorId}`,
		hallId,
		sha256,
		svgAssetUrl: `/assets/dining/${hallId}-${floorId}.svg`,
		svgMarkup: buildStandardFloorplanSvg({ floorId, label }),
	};
}

function buildStandardFloorplanSvg(input: { floorId: string; label: string }): string {
	const windows = STANDARD_WINDOW_ANCHORS.map((anchor, index) => {
		const column = index % 3;
		const row = Math.floor(index / 3);
		const x = 64 + column * 180;
		const y = 72 + row * 112;
		return `<g data-dining-role="window" data-dining-anchor-id="${anchor.anchorId}" data-dining-label="${anchor.label}"><rect x="${x}" y="${y}" width="150" height="72" rx="8" fill="#fbfbf8" stroke="#b8c3d1"/><text x="${
			x + 75
		}" y="${y + 42}" text-anchor="middle" font-size="15" fill="#334155">${anchor.label}</text></g>`;
	}).join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420" role="img" aria-label="${input.label}" data-dining-floor-id="${input.floorId}"><rect x="24" y="24" width="672" height="372" rx="20" fill="#f6f8f7" stroke="#d7dee8"/><text x="56" y="54" font-size="18" fill="#334155">${input.label}</text>${windows}<rect x="120" y="320" width="480" height="42" rx="14" fill="#f4f1ea"/><text x="360" y="347" text-anchor="middle" font-size="14" fill="#64748b">就餐区</text></svg>`;
}

function assertRequiredManifestFields(input: DiningFloorplanManifestInput): void {
	for (const field of ["floorId", "floorplanId", "hallId", "svgAssetUrl", "svgMarkup"] as const) {
		if (!input[field].trim()) {
			throw new Error(`Dining floorplan manifest field is required: ${field}`);
		}
	}
	if (!(input.svgAssetUrl.startsWith("/assets/dining/") && input.svgAssetUrl.endsWith(".svg"))) {
		throw new Error(`Dining floorplan SVG asset URL is invalid: ${input.svgAssetUrl}`);
	}
}

function sanitizeSvgMarkup(svgMarkup: string): string {
	const parser = new XMLParser(XML_OPTIONS);
	let parsed: unknown;
	try {
		parsed = parser.parse(svgMarkup);
	} catch {
		throw new Error("Dining SVG markup is not valid XML.");
	}
	if (!parsed || typeof parsed !== "object" || !("svg" in parsed)) {
		throw new Error("Dining SVG root element is required.");
	}
	assertSafeSvgNode(parsed);
	const builder = new XMLBuilder({
		...XML_OPTIONS,
		format: false,
		suppressBooleanAttributes: false,
	});
	return builder.build(parsed);
}

function assertSafeSvgNode(value: unknown): void {
	if (!value || typeof value !== "object") {
		return;
	}

	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (key.startsWith("@_on") || key === "@_href" || key === "@_xlink:href") {
			throw new Error(`Forbidden dining SVG attribute: ${key}`);
		}
		if (FORBIDDEN_TAGS.has(key)) {
			throw new Error(`Forbidden dining SVG element: ${key}`);
		}
		assertSafeSvgNode(nested);
	}
}

function extractDiningSvgAnchors(svgMarkup: string): DiningFloorplanAnchor[] {
	const parser = new XMLParser(XML_OPTIONS);
	const parsed = parser.parse(svgMarkup);
	const anchors: DiningFloorplanAnchor[] = [];
	const seen = new Set<string>();

	visitSvgNode(parsed, (node) => {
		const anchorId = readString(node["@_data-dining-anchor-id"]);
		if (!anchorId) {
			return;
		}
		if (seen.has(anchorId)) {
			throw new Error(`Duplicate dining SVG anchor: ${anchorId}`);
		}
		seen.add(anchorId);

		const role = normalizeAnchorRole(readString(node["@_data-dining-role"]));
		anchors.push({
			anchorId,
			label: readString(node["@_data-dining-label"]) ?? undefined,
			role,
		});
	});

	return anchors;
}

function assertAnchorInventoryMatchesSvg(input: {
	anchorInventory: readonly DiningFloorplanAnchor[];
	extractedAnchors: readonly DiningFloorplanAnchor[];
	floorplanId: string;
}): void {
	const inventoryAnchorIds = input.anchorInventory.map((anchor) => anchor.anchorId);
	const extractedAnchorIds = input.extractedAnchors.map((anchor) => anchor.anchorId);
	const inventorySet = new Set(inventoryAnchorIds);

	if (inventorySet.size !== inventoryAnchorIds.length) {
		throw new Error(`Duplicate dining manifest anchor: ${input.floorplanId}`);
	}

	const sameLength = inventoryAnchorIds.length === extractedAnchorIds.length;
	const sameOrder = inventoryAnchorIds.every(
		(anchorId, index) => anchorId === extractedAnchorIds[index],
	);
	if (!(sameLength && sameOrder)) {
		throw new Error(
			`Dining manifest anchor inventory does not match extracted anchors: ${input.floorplanId}`,
		);
	}
}

function normalizeAnchorRole(value: string | null): DiningFloorplanAnchorRole {
	if (!value) {
		return "region";
	}
	if (!ALLOWED_ANCHOR_ROLES.has(value as DiningFloorplanAnchorRole)) {
		throw new Error(`Unsupported dining SVG anchor role: ${value}`);
	}
	return value as DiningFloorplanAnchorRole;
}

function visitSvgNode(value: unknown, visitor: (node: Record<string, unknown>) => void): void {
	if (!value || typeof value !== "object") {
		return;
	}
	const record = value as Record<string, unknown>;
	visitor(record);
	for (const nested of Object.values(record)) {
		if (Array.isArray(nested)) {
			for (const item of nested) {
				visitSvgNode(item, visitor);
			}
			continue;
		}
		visitSvgNode(nested, visitor);
	}
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
