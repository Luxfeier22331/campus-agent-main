import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo } from "react";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";
import type { DiningFloorplanRef, DiningWindow } from "../../features/dining/model";

export interface DiningSvgAnchor {
	anchorId: string;
	role: string;
	windowId: string | null;
	windowLabel: string | null;
}

export function SvgFloorplanWorkspace(input: {
	floorId: string;
	floorplan: DiningFloorplanRef;
	onSelectAnchor?(anchor: DiningSvgAnchor): void;
	onSelectWindow(windowId: string): void;
	selectedWindowId: string | null;
	selectedAnchorId?: string | null;
	svgMarkup: string;
	windows: DiningWindow[];
}) {
	const markup = input.svgMarkup;
	const anchors = useMemo(
		() => extractDiningAnchors(markup, input.windows),
		[markup, input.windows],
	);
	const selectedWindow = input.windows.find((window) => window.windowId === input.selectedWindowId);
	const selectedAnchorId =
		input.selectedAnchorId ?? (selectedWindow ? anchorIdForWindow(selectedWindow) : null);
	const normalizedFloorplan = useMemo(
		() => markSelectedAnchor(markup, selectedAnchorId),
		[markup, selectedAnchorId],
	);
	const boundAnchorCount = anchors.filter((anchor) => anchor.windowId).length;
	const missingBindingCount = anchors.length - boundAnchorCount;
	const shortSha = input.floorplan.sha256.replace(/^sha256:/, "").slice(0, 12);

	useEffect(() => {
		if (!(input.selectedAnchorId || input.selectedWindowId) && anchors[0]?.windowId) {
			input.onSelectWindow(anchors[0].windowId);
		}
	}, [anchors, input.onSelectWindow, input.selectedAnchorId, input.selectedWindowId]);

	function selectAnchor(anchor: DiningSvgAnchor) {
		input.onSelectAnchor?.(anchor);
		if (anchor.windowId) {
			input.onSelectWindow(anchor.windowId);
		}
	}

	return (
		<div className="dining-workbench">
			<div className="dining-workbench-toolbar">
				<div>
					<p className="ops-eyebrow">版本化平面图</p>
					<h3 className="font-semibold text-base">{input.floorId}.svg</h3>
					<p className="mt-1 max-w-[420px] truncate text-xs text-slate-500">
						{input.floorplan.floorplanId} · sha256:{shortSha}
					</p>
				</div>
				<ul className="dining-metrics" aria-label="SVG 资产指标">
					<Metric label="区块" value={anchors.length} />
					<Metric label="已绑定" value={boundAnchorCount} />
					<Metric label="未绑定" value={missingBindingCount} />
				</ul>
				<p className="max-w-[260px] text-xs text-slate-500">
					SVG 底图随应用发版，当前页面只维护区块绑定、餐饮点和菜单价格草稿。
				</p>
			</div>
			<div className="dining-workbench-grid">
				<section className="dining-workbench-pane">
					<PaneHeader eyebrow="区块" title="区块目录" />
					<AnchorInventoryTable
						anchors={anchors}
						onSelectAnchor={selectAnchor}
						selectedAnchorId={selectedAnchorId}
					/>
				</section>
				<section className="dining-floorplan-pane">
					<PaneHeader eyebrow="预览" title="平面图预览" />
					<TransformWrapper
						centerOnInit
						limitToBounds={false}
						maxScale={3}
						minScale={0.65}
						wheel={{ step: 0.08 }}
						pinch={{ step: 6 }}
					>
						<SvgPreviewSurface
							anchors={anchors}
							markup={normalizedFloorplan.markup}
							onSelectAnchor={selectAnchor}
							selectedAnchorId={selectedAnchorId}
							selectedZoomTarget={normalizedFloorplan.selectedZoomTarget}
						/>
					</TransformWrapper>
				</section>
			</div>
		</div>
	);
}

function AnchorInventoryTable(input: {
	anchors: DiningSvgAnchor[];
	onSelectAnchor(anchor: DiningSvgAnchor): void;
	selectedAnchorId: string | null;
}) {
	const columns = useMemo<ColumnDef<DiningSvgAnchor>[]>(
		() => [
			{
				accessorKey: "anchorId",
				cell: ({ row }) => (
					<button
						aria-label={`SVG 区块 ${row.original.anchorId}`}
						className={[
							"dining-anchor-row",
							row.original.anchorId === input.selectedAnchorId ? "is-selected" : "",
						].join(" ")}
						onClick={() => input.onSelectAnchor(row.original)}
						type="button"
					>
						<span className="dining-anchor-id">{row.original.anchorId}</span>
					</button>
				),
				header: "区块",
			},
			{
				accessorKey: "role",
				cell: ({ row }) => (
					<span className="dining-anchor-meta">{formatAnchorRole(row.original.role)}</span>
				),
				header: "类型",
			},
			{
				accessorKey: "windowLabel",
				cell: ({ row }) => (
					<span className={row.original.windowId ? "dining-status-bound" : "dining-status-missing"}>
						{row.original.windowLabel ?? "未绑定"}
					</span>
				),
				header: "绑定",
			},
		],
		[input.onSelectAnchor, input.selectedAnchorId],
	);
	const table = useReactTable({
		columns,
		data: input.anchors,
		getCoreRowModel: getCoreRowModel(),
	});
	if (input.anchors.length === 0) {
		return <p className="p-3 text-sm text-zinc-500">SVG 中没有 data-dining-anchor-id。</p>;
	}
	return (
		<div className="dining-anchor-table-wrap">
			<table aria-label="SVG 区块目录" className="dining-anchor-table">
				<thead>
					{table.getHeaderGroups().map((headerGroup) => (
						<tr key={headerGroup.id}>
							{headerGroup.headers.map((header) => (
								<th key={header.id}>
									{header.isPlaceholder
										? null
										: flexRender(header.column.columnDef.header, header.getContext())}
								</th>
							))}
						</tr>
					))}
				</thead>
				<tbody>
					{table.getRowModel().rows.map((row) => (
						<tr key={row.id}>
							{row.getVisibleCells().map((cell) => (
								<td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function SvgPreviewSurface(input: {
	anchors: DiningSvgAnchor[];
	markup: string;
	onSelectAnchor(anchor: DiningSvgAnchor): void;
	selectedAnchorId: string | null;
	selectedZoomTarget: string | null;
}) {
	const { centerView, resetTransform, zoomIn, zoomOut, zoomToElement } = useControls();
	useEffect(() => {
		if (!input.selectedZoomTarget) {
			return;
		}
		const selector = `[data-dining-zoom-target="${input.selectedZoomTarget}"]`;
		if (!document.querySelector(selector)) {
			return;
		}
		zoomToElement(selector, 1.35, 160, "easeOut");
	}, [input.selectedZoomTarget, zoomToElement]);
	return (
		<div className="dining-svg-preview-shell">
			<div className="dining-svg-controls" role="toolbar" aria-label="平面图视图控制">
				<button aria-label="放大平面图" onClick={() => zoomIn(0.25, 120)} type="button">
					<ZoomIn aria-hidden="true" className="size-4" />
				</button>
				<button aria-label="缩小平面图" onClick={() => zoomOut(0.25, 120)} type="button">
					<ZoomOut aria-hidden="true" className="size-4" />
				</button>
				<button
					aria-label="适配平面图"
					onClick={() => {
						resetTransform(0);
						centerView(1, 120);
					}}
					type="button"
				>
					<Maximize2 aria-hidden="true" className="size-4" />
				</button>
			</div>
			<TransformComponent
				contentClass="dining-svg-preview-content"
				wrapperClass="dining-svg-preview"
			>
				<button
					aria-label="SVG 平面图预览"
					className="dining-svg-preview-button"
					onKeyDown={(event) => {
						if (event.key !== "Enter" && event.key !== " ") {
							return;
						}
						const selectedAnchor = input.anchors.find(
							(anchor) => anchor.anchorId === input.selectedAnchorId,
						);
						if (selectedAnchor) {
							event.preventDefault();
							input.onSelectAnchor(selectedAnchor);
						}
					}}
					onClick={(event) => {
						const target = event.target;
						if (!(target instanceof Element)) {
							return;
						}
						const element = target.closest("[data-dining-anchor-id]");
						const anchorId = element?.getAttribute("data-dining-anchor-id");
						const anchor = input.anchors.find((item) => item.anchorId === anchorId);
						if (anchor) {
							input.onSelectAnchor(anchor);
						}
					}}
					type="button"
				>
					{/* biome-ignore lint/security/noDangerouslySetInnerHtml: repo-versioned dining SVG is sanitized in dining-floorplans before inline anchor interaction. */}
					<div dangerouslySetInnerHTML={{ __html: input.markup }} />
				</button>
			</TransformComponent>
		</div>
	);
}

function formatAnchorRole(role: string): string {
	if (role === "window") {
		return "餐饮点";
	}
	if (role === "stall") {
		return "摊位";
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
	return window.svgAnchorId ?? "";
}

function markSelectedAnchor(
	markup: string,
	selectedAnchorId: string | null,
): { markup: string; selectedZoomTarget: string | null } {
	const parser = new DOMParser();
	const document = parser.parseFromString(markup, "image/svg+xml");
	let selectedZoomTarget: string | null = null;
	for (const element of document.querySelectorAll("[data-dining-anchor-id]")) {
		const anchorId = element.getAttribute("data-dining-anchor-id");
		element.classList.add("dining-svg-anchor");
		if (anchorId) {
			const zoomTarget = toDiningZoomTarget(anchorId);
			element.setAttribute("data-dining-zoom-target", zoomTarget);
			if (anchorId === selectedAnchorId) {
				selectedZoomTarget = zoomTarget;
			}
		}
		if (anchorId === selectedAnchorId) {
			element.classList.add("is-selected");
		}
	}
	return {
		markup: new XMLSerializer().serializeToString(document.documentElement),
		selectedZoomTarget,
	};
}

function toDiningZoomTarget(anchorId: string): string {
	const slug = anchorId.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "anchor";
	let hash = 0;
	for (const char of anchorId) {
		hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	}
	return `dining-anchor-${slug}-${hash.toString(36)}`;
}
