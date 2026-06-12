import { Link } from "@tanstack/react-router";
import {
	Bell,
	BookOpen,
	CheckCircle2,
	GitBranch,
	History,
	Map as MapIcon,
	MessageSquare,
	Route,
	Settings2,
	Utensils,
} from "lucide-react";

import { cn } from "@/lib/utils";

const MODULES = [
	{
		area: "食堂",
		description: "编辑食堂、楼层、窗口、档口、菜品和价格草稿。",
		href: "/dining",
		icon: Utensils,
		label: "食堂数据",
		owner: "dining ops",
		status: "已接入",
	},
	{
		area: "食堂",
		description: "上传或替换食堂 SVG，维护区块锚点与窗口绑定。",
		href: "/dining/assets",
		icon: MapIcon,
		label: "食堂资产",
		owner: "dining ops",
		status: "已接入",
	},
	{
		area: "食堂",
		description: "从明确草稿版本创建候选，查看校验结果并审批发布。",
		href: "/dining/candidates",
		icon: GitBranch,
		label: "发布候选",
		owner: "dining ops",
		status: "候选发布",
	},
	{
		area: "食堂",
		description: "查看已发布快照、发布来源和回滚入口。",
		href: "/dining/releases",
		icon: History,
		label: "发布历史",
		owner: "dining ops",
		status: "已接入",
	},
	{
		area: "食堂",
		description: "查看食堂对象编辑与发布动作的审计记录。",
		href: "/dining/audit",
		icon: History,
		label: "食堂审计",
		owner: "dining ops",
		status: "已接入",
	},
	{
		area: "校园数据",
		description: "校园地点、建筑、道路与地图投影的后台入口。",
		href: "/map",
		icon: Route,
		label: "地图与地点",
		owner: "navigation",
		status: "预留路由",
	},
	{
		area: "校园数据",
		description: "学生侧反馈的分类、追踪和处理入口。",
		href: "/feedback",
		icon: MessageSquare,
		label: "反馈处理",
		owner: "feedback",
		status: "预留路由",
	},
	{
		area: "内容源",
		description: "制度、培养方案、官网稳定引用等知识源治理入口。",
		href: "/knowledge",
		icon: BookOpen,
		label: "知识源",
		owner: "knowledge",
		status: "预留路由",
	},
	{
		area: "内容源",
		description: "通知源、受限通知和正文抽取链路的后台入口。",
		href: "/notices",
		icon: Bell,
		label: "通知源",
		owner: "notice",
		status: "预留路由",
	},
	{
		area: "内容源",
		description: "校园服务指南、服务状态和结构化服务投影入口。",
		href: "/services",
		icon: Settings2,
		label: "校园服务",
		owner: "campus services",
		status: "预留路由",
	},
] as const;

const STATUS_SUMMARY = [
	{ label: "已接入", value: 5 },
	{ label: "候选发布", value: 1 },
	{ label: "预留路由", value: 5 },
] as const;

const DELIVERY_STEPS = [
	"食堂草稿编辑、SVG 资产、候选发布和审计已在当前工作面接入。",
	"非 dining 模块先保留路由，不开放写 API，不承诺编辑器已经完成。",
	"后续模块接入前必须先冻结对应 contract、权限和审计边界。",
] as const;

export function HomePage() {
	return (
		<section className="grid gap-4">
			<header className="grid items-start gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-xs lg:grid-cols-[minmax(0,1fr)_auto]">
				<div>
					<p className="ops-eyebrow">后台修改面</p>
					<h2 className="ops-title">后台修改面总览</h2>
					<p className="mt-1.5 max-w-3xl text-pretty text-sm leading-6 text-slate-600">
						统一承载学生侧产品数据的编辑、预览、发布与审计。当前工作面只把食堂做成可操作闭环，其余后台域先提供路由位置。
					</p>
				</div>
				<ul
					aria-label="后台模块状态统计"
					className="grid grid-cols-3 overflow-hidden rounded-[7px] border border-slate-200 bg-slate-50 text-center lg:grid-cols-[repeat(3,5.75rem)]"
				>
					{STATUS_SUMMARY.map((metric) => (
						<Metric key={metric.label} label={metric.label} value={metric.value} />
					))}
				</ul>
			</header>

			<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_270px]">
				<section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xs">
					<div className="grid gap-3 border-slate-200 border-b p-4 md:flex md:items-start md:justify-between">
						<div>
							<p className="ops-eyebrow">当前工作面</p>
							<h3 className="font-bold text-[0.9375rem] text-slate-800 leading-5">模块路由表</h3>
						</div>
						<p className="max-w-md text-[0.8125rem] text-slate-500 leading-5">
							入口、状态和 owner 放在同一张表里，避免把预留模块展示成已完成工作台。
						</p>
					</div>
					<div className="overflow-x-auto">
						<table
							aria-label="后台模块路由"
							className="block w-full border-collapse text-sm md:table md:table-fixed"
						>
							<thead className="hidden bg-slate-50 md:table-header-group">
								<tr>
									<th className="w-[55%] px-4 py-3 text-left font-bold text-slate-500 text-xs">
										模块
									</th>
									<th className="w-[18%] px-4 py-3 text-left font-bold text-slate-500 text-xs">
										状态
									</th>
									<th className="w-[27%] px-4 py-3 text-left font-bold text-slate-500 text-xs">
										路由
									</th>
								</tr>
							</thead>
							<tbody className="block md:table-row-group">
								{MODULES.map((module) => (
									<ModuleRow key={module.href} module={module} />
								))}
							</tbody>
						</table>
					</div>
				</section>

				<aside className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
					<section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-xs">
						<div>
							<div>
								<p className="ops-eyebrow">接入节奏</p>
								<h3 className="font-bold text-[0.9375rem] text-slate-800 leading-5">
									路由不等于能力完成
								</h3>
							</div>
						</div>
						<ol className="mt-3 list-none p-0 text-[0.8125rem] text-slate-600 leading-5">
							{DELIVERY_STEPS.map((step) => (
								<li
									className="relative border-slate-100 border-t py-2 pl-5 before:absolute before:top-[1.05rem] before:left-0 before:size-1.5 before:rounded-full before:bg-slate-400"
									key={step}
								>
									{step}
								</li>
							))}
						</ol>
					</section>
					<section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-xs">
						<div>
							<div>
								<p className="ops-eyebrow">边界</p>
								<h3 className="font-bold text-[0.9375rem] text-slate-800 leading-5">
									开发周期不开放
								</h3>
							</div>
						</div>
						<div className="mt-3 flex flex-wrap gap-2">
							{["商户自助", "实时排队", "营业状态", "支付点餐"].map((item) => (
								<span
									className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-600 text-xs"
									key={item}
								>
									{item}
								</span>
							))}
						</div>
					</section>
				</aside>
			</div>
		</section>
	);
}

function Metric(input: { label: string; value: number }) {
	return (
		<li className="border-slate-200 border-r px-3 py-2.5 last:border-r-0">
			<p className="font-semibold text-lg text-zinc-800 tabular-nums">{input.value}</p>
			<p className="mt-0.5 text-xs text-zinc-500">{input.label}</p>
		</li>
	);
}

function ModuleRow(input: { module: (typeof MODULES)[number] }) {
	const Icon = input.module.icon;

	return (
		<tr className="grid border-slate-200 border-b p-4 last:border-b-0 hover:bg-slate-50/70 md:table-row md:p-0">
			<td className="block align-middle md:table-cell md:border-slate-200 md:border-b md:px-4 md:py-3">
				<Link
					className="flex min-w-0 items-start gap-3 text-inherit no-underline focus-visible:outline-2 focus-visible:outline-zinc-950 focus-visible:outline-offset-2"
					to={input.module.href}
				>
					<span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600">
						<Icon aria-hidden="true" className="size-4" />
					</span>
					<div>
						<div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 font-bold text-slate-800">
							<span>{input.module.label}</span>
							<small className="font-semibold text-slate-500 text-xs">
								{input.module.area} · {input.module.owner}
							</small>
						</div>
						<p className="mt-1 max-w-lg text-[0.8125rem] text-slate-600 leading-5">
							{input.module.description}
						</p>
					</div>
				</Link>
			</td>
			<td className="block align-middle md:table-cell md:border-slate-200 md:border-b md:px-4 md:py-3">
				<div className="mt-3 flex items-center justify-between gap-4 pl-11 md:mt-0 md:block md:pl-0">
					<span className="font-bold text-slate-500 text-xs md:hidden">状态</span>
					<StatusPill status={input.module.status} />
				</div>
			</td>
			<td className="block align-middle md:table-cell md:border-slate-200 md:border-b md:px-4 md:py-3">
				<div className="mt-2 flex items-center justify-between gap-4 pl-11 md:mt-0 md:block md:pl-0">
					<span className="font-bold text-slate-500 text-xs md:hidden">路由</span>
					<Link
						className="whitespace-nowrap font-mono text-[0.8125rem] text-slate-600 no-underline hover:underline focus-visible:outline-2 focus-visible:outline-zinc-950 focus-visible:outline-offset-2"
						to={input.module.href}
					>
						{input.module.href}
					</Link>
				</div>
			</td>
		</tr>
	);
}

function StatusPill(input: { status: (typeof MODULES)[number]["status"] }) {
	return (
		<span
			className={cn(
				"inline-flex min-w-19 items-center justify-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-semibold text-xs",
				input.status === "已接入" && "border-emerald-200 bg-emerald-50 text-emerald-700",
				input.status === "候选发布" && "border-sky-200 bg-sky-50 text-sky-700",
				input.status === "预留路由" && "border-slate-200 bg-slate-50 text-slate-600",
			)}
		>
			{input.status === "已接入" ? <CheckCircle2 aria-hidden="true" className="size-3" /> : null}
			{input.status}
		</span>
	);
}
