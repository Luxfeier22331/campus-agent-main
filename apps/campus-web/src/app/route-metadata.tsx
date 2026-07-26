export interface CampusRouteMetadata {
	canonicalPath: string | null;
	description: string;
	robots: "index,follow" | "noindex,nofollow";
	title: string;
}

const PRODUCT_NAME = "中央民族大学校园问答";

export function resolveRouteMetadata(pathname: string): CampusRouteMetadata {
	if (pathname === "/") {
		return publicMetadata("校园问答", "查询中央民族大学校园信息并继续历史对话。", "/");
	}
	if (pathname.startsWith("/c/")) {
		return privateMetadata("校园问答", "继续当前校园问答对话。");
	}
	if (pathname === "/map") {
		return publicMetadata("校园地图", "通过校园地图查找校区地点和服务位置。", "/map");
	}
	if (pathname === "/dining") {
		return publicMetadata("食堂地图", "查看校园食堂、楼层和窗口分布。", "/dining");
	}
	if (pathname === "/services") {
		return publicMetadata("校园服务", "查看校车等已发布的校园服务信息。", "/services");
	}
	if (pathname === "/groups") {
		return publicMetadata("同好群", "查找面向本校学生公开的兴趣交流群。", "/groups");
	}
	if (pathname === "/feedback") {
		return publicMetadata("反馈", "向校园问答提交问题反馈和改进建议。", "/feedback");
	}
	if (pathname === "/legal/terms") {
		return publicMetadata("服务条款", "中央民族大学校园问答服务条款。", "/legal/terms");
	}
	if (pathname === "/legal/privacy") {
		return publicMetadata("隐私说明", "中央民族大学校园问答隐私说明。", "/legal/privacy");
	}
	if (pathname === "/account/settings/security") {
		return privateMetadata("账号安全", "管理当前校园问答账号的安全设置。");
	}
	if (pathname === "/account/settings/account") {
		return privateMetadata("账号设置", "管理当前校园问答账号资料。");
	}
	if (pathname === "/account/register") {
		return privateMetadata("注册", "创建校园问答账号。");
	}
	if (pathname === "/account/login") {
		return privateMetadata("登录", "登录校园问答账号。");
	}
	if (pathname.startsWith("/account")) {
		return privateMetadata("账号", "管理校园问答账号和登录状态。");
	}
	return privateMetadata("页面不存在", "当前页面不存在或暂时无法访问。");
}

export function RouteMetadata({ pathname }: { pathname: string }) {
	const metadata = resolveRouteMetadata(pathname);
	return (
		<>
			<title data-campus-route-metadata="true">{metadata.title}</title>
			<meta content={metadata.description} data-campus-route-metadata="true" name="description" />
			<meta content={metadata.robots} data-campus-route-metadata="true" name="robots" />
			{metadata.canonicalPath ? (
				<link data-campus-route-metadata="true" href={metadata.canonicalPath} rel="canonical" />
			) : null}
		</>
	);
}

function publicMetadata(
	title: string,
	description: string,
	canonicalPath: string,
): CampusRouteMetadata {
	return {
		canonicalPath,
		description,
		robots: "index,follow",
		title: `${title} | ${PRODUCT_NAME}`,
	};
}

function privateMetadata(title: string, description: string): CampusRouteMetadata {
	return {
		canonicalPath: null,
		description,
		robots: "noindex,nofollow",
		title: `${title} | ${PRODUCT_NAME}`,
	};
}
