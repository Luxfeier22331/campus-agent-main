import type { DiningFloorplanBundleV1 } from "@campus-agent/dining/floorplans";
import { cn } from "@campus-agent/ui";
import { Link, useRouterState } from "@tanstack/react-router";

const diningTasks = [
	{ href: "/dining", label: "地图" },
	{ href: "/dining/menu", label: "菜单" },
	{ href: "/dining/reviews", label: "评价" },
	{ href: "/dining/reports", label: "举报" },
] as const;

export interface DiningWindowOption {
	hallName: string;
	label: string;
	windowId: string;
}

export function DiningTaskNavigation() {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	return (
		<nav aria-label="食堂维护" className="mb-5 overflow-x-auto border-border border-b">
			<div className="flex min-w-max gap-1">
				{diningTasks.map((task) => {
					const active = pathname === task.href;
					return (
						<Link
							aria-current={active ? "page" : undefined}
							className={cn(
								"min-h-11 border-b-2 px-4 py-3 font-medium text-sm",
								active
									? "border-primary text-foreground"
									: "border-transparent text-muted-foreground hover:text-foreground",
							)}
							key={task.href}
							to={task.href}
						>
							{task.label}
						</Link>
					);
				})}
			</div>
		</nav>
	);
}

export function diningWindowOptions(bundle: DiningFloorplanBundleV1): DiningWindowOption[] {
	const halls = new Map(bundle.halls.map((hall) => [hall.hallId, hall.name]));
	return bundle.layouts.flatMap((layout) =>
		layout.windows.map((window) => ({
			hallName: halls.get(layout.hallId) ?? layout.hallId,
			label: `${halls.get(layout.hallId) ?? layout.hallId} / ${layout.label} / ${window.label}`,
			windowId: `${layout.hallId}:${layout.floorId}:${window.anchorId}`,
		})),
	);
}
