import { useTheme } from "@campus-agent/ui";
import { useMemo } from "react";

export interface StyleDevToken {
	name: string;
	label: string;
	group: "画布与表面" | "文字与边框" | "品牌与状态" | "聊天内容" | "聊天强调" | "排版与布局";
	swatch?: boolean;
}

export const STYLE_DEV_TOKENS: readonly StyleDevToken[] = [
	{ group: "画布与表面", label: "画布", name: "--sys-bg-canvas", swatch: true },
	{ group: "画布与表面", label: "默认表面", name: "--sys-surface-default", swatch: true },
	{ group: "画布与表面", label: "弱表面", name: "--sys-bg-muted", swatch: true },
	{ group: "画布与表面", label: "悬停表面", name: "--sys-surface-hover", swatch: true },
	{ group: "画布与表面", label: "Campus 选中表面", name: "--campus-selected-bg", swatch: true },
	{ group: "文字与边框", label: "主要文字", name: "--sys-text-strong" },
	{ group: "文字与边框", label: "正文文字", name: "--sys-text-default" },
	{ group: "文字与边框", label: "弱文字", name: "--sys-text-muted" },
	{ group: "文字与边框", label: "边框", name: "--sys-border-subtle", swatch: true },
	{ group: "文字与边框", label: "Campus 焦点环", name: "--campus-focus-ring", swatch: true },
	{ group: "品牌与状态", label: "Campus 品牌墨色", name: "--campus-brand-identity", swatch: true },
	{ group: "品牌与状态", label: "Campus 主操作", name: "--campus-action", swatch: true },
	{ group: "品牌与状态", label: "Campus 链接文字", name: "--campus-link", swatch: true },
	{ group: "品牌与状态", label: "成功", name: "--sys-status-success", swatch: true },
	{ group: "品牌与状态", label: "警告", name: "--sys-status-warning", swatch: true },
	{ group: "品牌与状态", label: "危险", name: "--sys-status-danger", swatch: true },
	{ group: "聊天强调", label: "聊天强调色", name: "--chat-accent", swatch: true },
	{ group: "聊天强调", label: "聊天浅背景", name: "--chat-accent-subtle", swatch: true },
	{ group: "聊天强调", label: "聊天强调文字", name: "--chat-accent-text", swatch: true },
	{ group: "聊天强调", label: "聊天边框", name: "--chat-accent-border", swatch: true },
	{ group: "聊天内容", label: "用户消息背景", name: "--chat-message-user-bg", swatch: true },
	{ group: "聊天内容", label: "用户消息正文", name: "--chat-message-user-text" },
	{ group: "聊天内容", label: "用户消息时间", name: "--chat-message-user-meta" },
	{ group: "排版与布局", label: "正文字号", name: "--font-size-md" },
	{ group: "排版与布局", label: "阅读宽度", name: "--layout-reading-width" },
	{ group: "排版与布局", label: "问答工作区宽度", name: "--layout-page-workspace-width" },
	{ group: "排版与布局", label: "小动效时长", name: "--motion-duration-fast" },
];

function tokenHost(): Element {
	return document.querySelector('[data-ui-profile="campus"]') ?? document.documentElement;
}

function readToken(name: string, _resolvedTheme: string): string {
	return getComputedStyle(tokenHost()).getPropertyValue(name).trim() || "未定义";
}

export function TokenCatalog() {
	const { resolvedTheme } = useTheme();
	const values = useMemo(
		() =>
			Object.fromEntries(
				STYLE_DEV_TOKENS.map((token) => [token.name, readToken(token.name, resolvedTheme)]),
			),
		[resolvedTheme],
	);

	const groups = Array.from(new Set(STYLE_DEV_TOKENS.map((token) => token.group)));
	return (
		<div className="style-dev-token-grid">
			{groups.map((group) => (
				<section className="style-dev-token-group" key={group}>
					<h3>{group}</h3>
					<ul>
						{STYLE_DEV_TOKENS.filter((token) => token.group === group).map((token) => {
							const value = values[token.name] ?? "读取中";
							return (
								<li className="style-dev-token-row" key={token.name}>
									{token.swatch ? (
										<span
											aria-hidden
											className="style-dev-token-swatch"
											style={{ background: `var(${token.name})` }}
										/>
									) : null}
									<span className="style-dev-token-label">{token.label}</span>
									<code>{token.name}</code>
									<output>{value}</output>
								</li>
							);
						})}
					</ul>
				</section>
			))}
		</div>
	);
}
