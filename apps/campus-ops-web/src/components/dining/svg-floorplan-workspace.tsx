import { Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DiningFloorplanAsset, DiningWindow } from "../../features/dining/model";

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420" role="img" aria-label="食堂楼层示意图">
  <rect x="24" y="24" width="672" height="372" rx="20" fill="#fff" stroke="#d7dee8" />
  <g data-dining-role="window" data-dining-anchor-id="window-01">
    <rect x="64" y="72" width="150" height="72" rx="8" fill="#fff" stroke="#b8c3d1" />
    <text x="139" y="114" text-anchor="middle" font-size="14" fill="#334155">一号窗口</text>
  </g>
  <g data-dining-role="window" data-dining-anchor-id="window-02">
    <rect x="244" y="72" width="150" height="72" rx="8" fill="#fff" stroke="#b8c3d1" />
    <text x="319" y="114" text-anchor="middle" font-size="14" fill="#334155">二号窗口</text>
  </g>
  <g data-dining-role="window" data-dining-anchor-id="window-03">
    <rect x="424" y="72" width="150" height="72" rx="8" fill="#fff" stroke="#b8c3d1" />
    <text x="499" y="114" text-anchor="middle" font-size="14" fill="#334155">三号窗口</text>
  </g>
  <rect x="120" y="220" width="480" height="72" rx="16" fill="#f4f7fa" />
  <text x="360" y="262" text-anchor="middle" font-size="15" fill="#7b8797">就餐区</text>
</svg>`;

export interface DiningSvgAnchor {
	anchorId: string;
	role: string;
	windowId: string | null;
	windowLabel: string | null;
}

export function SvgFloorplanWorkspace(input: {
	floorId: string;
	floorplanAsset?: DiningFloorplanAsset;
	onSelectWindow(windowId: string): void;
	onUploadSvg(input: {
		floorId: string;
		sourceFilename: string;
		svgMarkup: string;
	}): Promise<unknown>;
	selectedWindowId: string | null;
	svgAssetUrl?: string | null;
	svgMarkup?: string | null;
	uploadError?: string | null;
	uploadState?: "idle" | "uploading" | "success";
	windows: DiningWindow[];
}) {
	const [assetSvg, setAssetSvg] = useState<string | null>(null);
	const [uploadedSvg, setUploadedSvg] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const markup = uploadedSvg ?? input.svgMarkup ?? assetSvg ?? FALLBACK_SVG;
	const anchors = useMemo(
		() => extractDiningAnchors(markup, input.windows),
		[markup, input.windows],
	);
	const selectedWindow = input.windows.find((window) => window.windowId === input.selectedWindowId);
	const selectedAnchorId = selectedWindow ? anchorIdForWindow(selectedWindow) : null;
	const normalizedMarkup = useMemo(
		() => markSelectedAnchor(markup, selectedAnchorId),
		[markup, selectedAnchorId],
	);
	const boundAnchorCount = anchors.filter((anchor) => anchor.windowId).length;
	const missingBindingCount = anchors.length - boundAnchorCount;
	const shortSha = input.floorplanAsset?.sha256.replace(/^sha256:/, "").slice(0, 12) ?? null;

	useEffect(() => {
		if (!input.selectedWindowId && anchors[0]?.windowId) {
			input.onSelectWindow(anchors[0].windowId);
		}
	}, [anchors, input.onSelectWindow, input.selectedWindowId]);

	useEffect(() => {
		if (input.svgMarkup || !input.svgAssetUrl) {
			setAssetSvg(null);
			return;
		}
		let cancelled = false;
		fetch(input.svgAssetUrl)
			.then((response) => (response.ok ? response.text() : null))
			.then((svg) => {
				if (!cancelled) {
					setAssetSvg(svg);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setAssetSvg(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [input.svgAssetUrl, input.svgMarkup]);

	function selectAnchor(anchor: DiningSvgAnchor) {
		if (anchor.windowId) {
			input.onSelectWindow(anchor.windowId);
		}
	}

	return (
		<div className="dining-workbench">
			<div className="dining-workbench-toolbar">
				<div>
					<p className="ops-eyebrow">Floorplan Asset</p>
					<h3 className="font-semibold text-base">{input.floorId}.svg</h3>
					{input.floorplanAsset ? (
						<p className="mt-1 max-w-[320px] truncate text-xs text-slate-500">
							{shortSha ? `sha256:${shortSha}` : input.floorplanAsset.floorplanAssetId} ·{" "}
							{formatBytes(input.floorplanAsset.byteSize)}
						</p>
					) : null}
				</div>
				<ul className="dining-metrics" aria-label="SVG 资产指标">
					<Metric label="区块" value={anchors.length} />
					<Metric label="已绑定" value={boundAnchorCount} />
					<Metric label="未绑定" value={missingBindingCount} />
				</ul>
				<button
					className="ops-secondary-button"
					disabled={input.uploadState === "uploading"}
					onClick={() => fileInputRef.current?.click()}
					type="button"
				>
					<Upload aria-hidden="true" className="size-4" />
					{input.uploadState === "uploading" ? "上传中" : "上传替换 SVG"}
				</button>
				<input
					accept=".svg,image/svg+xml"
					aria-label="上传替换 SVG 文件"
					className="sr-only"
					onChange={(event) => {
						const inputElement = event.currentTarget;
						const file = event.currentTarget.files?.[0];
						if (!file) {
							return;
						}
						void readSvgFile(file).then(async (svgMarkup) => {
							setUploadedSvg(svgMarkup);
							await input.onUploadSvg({
								floorId: input.floorId,
								sourceFilename: file.name,
								svgMarkup,
							});
							inputElement.value = "";
						});
					}}
					ref={fileInputRef}
					type="file"
				/>
				{input.uploadState === "success" ? (
					<p className="text-emerald-700 text-xs">SVG 已上传</p>
				) : null}
				{input.uploadError ? <p className="text-red-600 text-xs">{input.uploadError}</p> : null}
			</div>
			<div className="dining-workbench-grid">
				<section className="dining-workbench-pane">
					<PaneHeader eyebrow="区块" title="区块目录" />
					<div className="dining-anchor-list">
						{anchors.map((anchor) => (
							<button
								aria-label={`SVG 区块 ${anchor.anchorId}`}
								className={[
									"dining-anchor-row",
									anchor.windowId === input.selectedWindowId ? "is-selected" : "",
								].join(" ")}
								key={anchor.anchorId}
								onClick={() => selectAnchor(anchor)}
								type="button"
							>
								<span>
									<span className="dining-anchor-id">{anchor.anchorId}</span>
									<span className="dining-anchor-meta">{formatAnchorRole(anchor.role)}</span>
								</span>
								<span className={anchor.windowId ? "dining-status-bound" : "dining-status-missing"}>
									{anchor.windowLabel ?? "未绑定"}
								</span>
							</button>
						))}
						{anchors.length === 0 ? (
							<p className="p-3 text-sm text-zinc-500">SVG 中没有 data-dining-anchor-id。</p>
						) : null}
					</div>
				</section>
				<section className="dining-floorplan-pane">
					<PaneHeader eyebrow="预览" title="平面图预览" />
					<button
						aria-label="SVG 平面图预览"
						className="dining-svg-preview"
						onKeyDown={(event) => {
							if (event.key !== "Enter" && event.key !== " ") {
								return;
							}
							const selectedAnchor = anchors.find(
								(anchor) => anchor.windowId === input.selectedWindowId,
							);
							if (selectedAnchor) {
								event.preventDefault();
								selectAnchor(selectedAnchor);
							}
						}}
						onClick={(event) => {
							const target = event.target;
							if (!(target instanceof Element)) {
								return;
							}
							const element = target.closest("[data-dining-anchor-id]");
							const anchorId = element?.getAttribute("data-dining-anchor-id");
							const anchor = anchors.find((item) => item.anchorId === anchorId);
							if (anchor) {
								selectAnchor(anchor);
							}
						}}
						type="button"
					>
						{/* biome-ignore lint/security/noDangerouslySetInnerHtml: demo SVG markup is parsed and reserialized before inline anchor interaction; production upload validation is server-side. */}
						<div dangerouslySetInnerHTML={{ __html: normalizedMarkup }} />
					</button>
				</section>
			</div>
		</div>
	);
}

function formatAnchorRole(role: string): string {
	if (role === "window") {
		return "窗口";
	}
	if (role === "seating") {
		return "就餐区";
	}
	if (role === "entrance") {
		return "入口";
	}
	return role;
}

function PaneHeader(input: { eyebrow: string; title: string }) {
	return (
		<div className="dining-pane-header">
			<p>{input.eyebrow}</p>
			<h4>{input.title}</h4>
		</div>
	);
}

function Metric(input: { label: string; value: number }) {
	return (
		<li>
			<span>{input.value}</span>
			<p>{input.label}</p>
		</li>
	);
}

function formatBytes(value: number): string {
	if (value < 1024) {
		return `${value} B`;
	}
	return `${(value / 1024).toFixed(1)} KB`;
}

function readSvgFile(file: File): Promise<string> {
	if ("text" in file && typeof file.text === "function") {
		return file.text();
	}
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("load", () => {
			if (typeof reader.result === "string") {
				resolve(reader.result);
				return;
			}
			reject(new Error("SVG 文件读取失败"));
		});
		reader.addEventListener("error", () => reject(new Error("SVG 文件读取失败")));
		reader.readAsText(file);
	});
}

function extractDiningAnchors(markup: string, windows: DiningWindow[]): DiningSvgAnchor[] {
	const parser = new DOMParser();
	const document = parser.parseFromString(markup, "image/svg+xml");
	const elements = [...document.querySelectorAll("[data-dining-anchor-id]")];
	const seen = new Set<string>();
	return elements.flatMap((element) => {
		const anchorId = element.getAttribute("data-dining-anchor-id")?.trim();
		if (!anchorId || seen.has(anchorId)) {
			return [];
		}
		seen.add(anchorId);
		const window = windows.find((item) => anchorIdForWindow(item) === anchorId) ?? null;
		return [
			{
				anchorId,
				role: element.getAttribute("data-dining-role") ?? "region",
				windowId: window?.windowId ?? null,
				windowLabel: window?.label ?? null,
			},
		];
	});
}

function anchorIdForWindow(window: DiningWindow): string {
	return window.svgAnchorId ?? window.windowId.split(":").at(-1) ?? window.windowId;
}

function markSelectedAnchor(markup: string, selectedAnchorId: string | null): string {
	const parser = new DOMParser();
	const document = parser.parseFromString(markup, "image/svg+xml");
	for (const element of document.querySelectorAll("[data-dining-anchor-id]")) {
		element.classList.add("dining-svg-anchor");
		if (element.getAttribute("data-dining-anchor-id") === selectedAnchorId) {
			element.classList.add("is-selected");
		}
	}
	return new XMLSerializer().serializeToString(document.documentElement);
}
