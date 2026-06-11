import { useMemo, useState } from "react";
import { SvgFloorplanWorkspace } from "../../components/dining/svg-floorplan-workspace";
import type {
	DiningMenuOffering,
	DiningOpsFloorResponse,
	DiningWindow,
} from "../../features/dining/model";

const DEMO_FLOOR: DiningOpsFloorResponse = {
	assignments: [
		{
			assignmentId: "assignment:demo:window-01",
			stallProfileId: "stall:demo:rice",
			status: "active",
			windowId: "demo:floor-1:window-01",
		},
		{
			assignmentId: "assignment:demo:window-02",
			stallProfileId: "stall:demo:noodle",
			status: "active",
			windowId: "demo:floor-1:window-02",
		},
	],
	floor: {
		floorId: "floor-1",
		hallId: "demo-hall",
		label: "SVG 绑定 Demo",
		svgAssetUrl: "/assets/dining/haidian-canteen-1-1f.svg",
	},
	menuItems: [
		{ menuItemId: "menu:demo:rice", name: "番茄牛腩饭", status: "active", tags: ["主食"] },
		{ menuItemId: "menu:demo:noodle", name: "牛肉面", status: "active", tags: ["面食"] },
	],
	menuOfferings: [
		{
			assignmentId: "assignment:demo:window-01",
			menuItemId: "menu:demo:rice",
			offeringId: "offering:demo:rice",
			priceLabel: "18 元",
			saleStatus: "available",
			specLabel: "标准份",
		},
		{
			assignmentId: "assignment:demo:window-02",
			menuItemId: "menu:demo:noodle",
			offeringId: "offering:demo:noodle",
			priceLabel: "16 元",
			saleStatus: "seasonal",
			specLabel: "标准碗",
		},
	],
	stallProfiles: [
		{
			displayName: "盖饭窗口",
			stallProfileId: "stall:demo:rice",
			stallType: "seeded_food_window",
			status: "active",
			tags: ["主食", "热餐"],
		},
		{
			displayName: "面食窗口",
			stallProfileId: "stall:demo:noodle",
			stallType: "seeded_food_window",
			status: "active",
			tags: ["面食"],
		},
	],
	windows: [
		{
			floorId: "floor-1",
			geometry: { height: 72, width: 150, x: 64, y: 72 },
			hallId: "demo-hall",
			label: "一号窗口",
			locationLabel: "入口左侧",
			status: "active",
			svgAnchorId: "window-01",
			tags: ["热餐"],
			windowId: "demo:floor-1:window-01",
		},
		{
			floorId: "floor-1",
			geometry: { height: 72, width: 150, x: 244, y: 72 },
			hallId: "demo-hall",
			label: "二号窗口",
			locationLabel: "中部东侧",
			status: "active",
			svgAnchorId: "window-02",
			tags: ["面食"],
			windowId: "demo:floor-1:window-02",
		},
		{
			floorId: "floor-1",
			geometry: { height: 72, width: 150, x: 424, y: 72 },
			hallId: "demo-hall",
			label: "三号窗口",
			locationLabel: "入口右侧",
			status: "closed",
			svgAnchorId: "window-03",
			tags: ["早餐"],
			windowId: "demo:floor-1:window-03",
		},
	],
};

export function DiningSvgDemoPage() {
	const [selectedWindowId, setSelectedWindowId] = useState<string | null>(
		DEMO_FLOOR.windows[0]?.windowId ?? null,
	);
	const selectedWindow =
		DEMO_FLOOR.windows.find((window) => window.windowId === selectedWindowId) ?? null;
	const boundWindowCount = DEMO_FLOOR.windows.filter((window) => window.svgAnchorId).length;

	return (
		<section className="space-y-4">
			<div className="dining-demo-header">
				<div>
					<p className="ops-eyebrow">食堂平面图</p>
					<h2>SVG 平面图工作台</h2>
				</div>
				<div className="dining-demo-status">
					<span>本地原型</span>
					<strong>
						{boundWindowCount}/{DEMO_FLOOR.windows.length} 个窗口已绑定
					</strong>
				</div>
			</div>
			<div className="dining-demo-layout">
				<SvgFloorplanWorkspace
					onSelectWindow={setSelectedWindowId}
					selectedWindowId={selectedWindowId}
					svgAssetUrl={DEMO_FLOOR.floor.svgAssetUrl}
					windows={DEMO_FLOOR.windows}
				/>
				<DemoWindowDetail floor={DEMO_FLOOR} selectedWindow={selectedWindow} />
			</div>
		</section>
	);
}

function DemoWindowDetail(input: {
	floor: DiningOpsFloorResponse;
	selectedWindow: DiningWindow | null;
}) {
	const current = useMemo(() => {
		if (!input.selectedWindow) {
			return null;
		}
		const assignment = input.floor.assignments.find(
			(item) => item.windowId === input.selectedWindow?.windowId,
		);
		const stall = assignment
			? input.floor.stallProfiles.find((item) => item.stallProfileId === assignment.stallProfileId)
			: null;
		const offerings = assignment
			? input.floor.menuOfferings
					.filter((item) => item.assignmentId === assignment.assignmentId)
					.map((offering) => ({
						menu:
							input.floor.menuItems.find((item) => item.menuItemId === offering.menuItemId) ?? null,
						offering,
					}))
			: [];
		return { assignment, offerings, stall };
	}, [input.floor, input.selectedWindow]);

	const checks = [
		{ label: "SVG 区块存在", state: Boolean(input.selectedWindow?.svgAnchorId) },
		{ label: "窗口已绑定档口", state: Boolean(current?.assignment) },
		{ label: "已配置展示菜品", state: (current?.offerings.length ?? 0) > 0 },
	];

	return (
		<aside className="dining-inspector">
			<div className="dining-pane-header">
				<p>详情</p>
				<h4>绑定详情</h4>
			</div>
			{input.selectedWindow ? (
				<div className="dining-inspector-body">
					<div>
						<p className="dining-inspector-kicker">当前区块</p>
						<h3>{input.selectedWindow.svgAnchorId ?? "未绑定"}</h3>
						<p>{input.selectedWindow.windowId}</p>
					</div>
					<div className="dining-binding-grid">
						<label className="ops-field">
							<span>SVG 区块</span>
							<input readOnly value={input.selectedWindow.svgAnchorId ?? ""} />
						</label>
						<label className="ops-field">
							<span>窗口</span>
							<input readOnly value={input.selectedWindow.label} />
						</label>
						<label className="ops-field">
							<span>档口</span>
							<input readOnly value={current?.stall?.displayName ?? "未绑定"} />
						</label>
						<label className="ops-field">
							<span>状态</span>
							<input readOnly value={formatWindowStatus(input.selectedWindow.status)} />
						</label>
					</div>
					<section className="dining-inspector-section">
						<div className="dining-pane-header compact">
							<p>菜品</p>
							<h4>绑定菜品</h4>
						</div>
						{current?.offerings.map(({ menu, offering }) => (
							<div className="dining-offering-row" key={offering.offeringId}>
								<span>{menu?.name ?? offering.menuItemId}</span>
								<strong>{offering.priceLabel}</strong>
								<small>{formatSaleStatus(offering.saleStatus)}</small>
							</div>
						))}
						{current?.offerings.length === 0 ? (
							<p className="text-sm text-zinc-500">当前区块没有绑定菜品。</p>
						) : null}
					</section>
					<section className="dining-inspector-section">
						<div className="dining-pane-header compact">
							<p>检查</p>
							<h4>发布检查</h4>
						</div>
						<div className="dining-check-list">
							{checks.map((check) => (
								<div key={check.label}>
									<span className={check.state ? "dining-dot-ok" : "dining-dot-warn"} />
									<p>{check.label}</p>
									<strong>{check.state ? "通过" : "阻塞"}</strong>
								</div>
							))}
						</div>
					</section>
				</div>
			) : (
				<p className="p-4 text-sm text-zinc-500">选择 SVG 区块后查看绑定数据。</p>
			)}
		</aside>
	);
}

function formatWindowStatus(status: DiningWindow["status"]): string {
	if (status === "active") {
		return "启用";
	}
	if (status === "closed") {
		return "关闭";
	}
	return "维护";
}

function formatSaleStatus(status: DiningMenuOffering["saleStatus"]): string {
	if (status === "available") {
		return "可售";
	}
	if (status === "paused") {
		return "暂停";
	}
	if (status === "seasonal") {
		return "季节供应";
	}
	return "下架";
}
