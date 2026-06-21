import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

const supportNavItems = [
	{ label: "文档", to: "/docs" },
	{ label: "校园地图", to: "/map" },
	{ label: "饭堂分布图", to: "/dining" },
	{ emphasis: true, label: "反馈", to: "/feedback" },
] as const;

export function SupportNavigation({
	activePath,
	className,
}: {
	activePath?: string;
	className?: string;
}) {
	const visibleItems = supportNavItems.filter(
		(item) => !(activePath === "/map" && item.to === "/feedback"),
	);
	return (
		<nav
			aria-label="支撑页面导航"
			className={cn("items-center gap-3", className ?? "hidden md:flex")}
		>
			{visibleItems.map((item) => {
				const active =
					activePath &&
					(item.to === "/docs" ? activePath.startsWith("/docs") : activePath === item.to);
				return (
					<Link
						className={cn(
							"inline-flex min-h-8 items-center border-b border-transparent text-xs font-medium text-muted-foreground hover:text-foreground",
							active && "border-foreground text-foreground",
							"emphasis" in item &&
								item.emphasis &&
								active &&
								"text-[var(--sys-brand-identity)] hover:text-[var(--sys-brand-identity)]",
						)}
						key={item.label}
						to={item.to}
					>
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}
