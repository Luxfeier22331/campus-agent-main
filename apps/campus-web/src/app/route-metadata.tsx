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
	if (pathname === "/groups") {
		return publicMetadata("同好群", "查找面向本校学生公开的兴趣交流群。", "/groups");
	}
	if (pathname === "/feedback") {
		return publicMetadata("反馈", "向校园问答提交问题反馈和改进建议。", "/feedback");
	}
	if (pathname === "/notices") {
		return privateMetadata("通知目录", "查询已收录的校园通知。");
	}
	if (pathname.startsWith("/notices/")) {
		return privateMetadata("通知详情", "查看已收录的校园通知正文。");
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
	if (pathname === "/account/change-password") {
		return privateMetadata("修改密码", "修改临时密码并恢复校园问答访问。");
	}
	if (pathname === "/account/forgot-password") {
		return privateMetadata("找回密码", "获取校园问答密码重置邮件。");
	}
	if (pathname === "/account/reset-password") {
		return privateMetadata("重置密码", "为校园问答账号设置新密码。");
	}
	if (pathname === "/account/reset-link-sent") {
		return privateMetadata("查收重置邮件", "查看校园问答密码重置邮件发送结果。");
	}
	if (pathname === "/account/reset-complete") {
		return privateMetadata("密码已更新", "校园问答账号密码已更新。");
	}
	if (pathname === "/account/verify-email") {
		return privateMetadata("验证邮箱", "获取校园问答邮箱验证邮件。");
	}
	if (pathname === "/account/verify-email/result") {
		return privateMetadata("邮箱验证结果", "查看校园问答邮箱验证结果。");
	}
	if (pathname === "/account/deletion") {
		return privateMetadata("注销请求已受理", "账号注销请求已经进入数据清理流程。");
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
