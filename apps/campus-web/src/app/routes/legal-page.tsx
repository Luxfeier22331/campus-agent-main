import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ProductBrandLink } from "@/components/navigation/product-navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const EFFECTIVE_DATE = "2026-06-18";

export function LegalTermsPage() {
	return (
		<LegalDocumentShell peerHref="/legal/privacy" peerLabel="隐私政策" title="用户服务协议">
			<LegalSection title="服务说明">
				<p>
					校园问答是面向中央民族大学相关校园信息的辅助性整理服务。它可以帮助你查询公开或已整理的校园资料、聊天记录和账号服务。
				</p>
				<p>
					回答不替代学校正式文件、官方通知、办事窗口意见、现场安排或其他具有正式效力的信息来源。
				</p>
			</LegalSection>
			<LegalSection title="账号责任">
				<p>注册时请使用可接收邮件的邮箱，并妥善保管账号和密码。</p>
				<p>你需要对通过账号提交的内容负责，包括问题、反馈和其他由你主动输入的信息。</p>
			</LegalSection>
			<LegalSection title="禁止行为">
				<ul>
					<li>攻击、扫描、干扰或滥用系统。</li>
					<li>提交违法、侵权、骚扰或明显无关内容。</li>
					<li>上传或输入你无权处理的他人信息。</li>
					<li>尝试绕过安全验证、访问控制或请求限制。</li>
				</ul>
			</LegalSection>
			<LegalSection title="AI 输出边界">
				<p>
					AI
					生成内容可能存在遗漏、延迟或理解偏差。涉及制度、流程、时间、地点和办理要求时，请以学校正式来源和现场情况为准。
				</p>
			</LegalSection>
			<LegalSection title="服务变更与账号限制">
				<p>服务可能因维护、配置调整、依赖异常或产品更新而暂时不可用。</p>
				<p>如出现明显滥用、攻击或违规使用，服务可以限制相关账号继续使用。</p>
			</LegalSection>
		</LegalDocumentShell>
	);
}

export function LegalPrivacyPage() {
	return (
		<LegalDocumentShell peerHref="/legal/terms" peerLabel="用户服务协议" title="隐私政策">
			<LegalSection title="我们处理的信息">
				<ul>
					<li>邮箱、显示名称、账号 ID 和会话状态。</li>
					<li>聊天内容、聊天记录、反馈内容和相关页面信息。</li>
					<li>个性化记忆或偏好摘要。</li>
					<li>安全验证结果、日志、错误信息和基础设备信息。</li>
				</ul>
			</LegalSection>
			<LegalSection title="处理目的">
				<ul>
					<li>提供注册、登录、密码重置和账号服务。</li>
					<li>提供问答、聊天记录和个性化体验。</li>
					<li>进行安全防护、故障排查和服务改进。</li>
				</ul>
			</LegalSection>
			<LegalSection title="第三方服务">
				<p>
					服务可能使用 Cloudflare Turnstile 进行安全验证，使用 AI 模型服务生成或整理回答，使用
					Sentry 等错误监控服务排查问题，并使用邮件服务发送账号相关邮件。
				</p>
				<p>这些服务只在完成上述功能所需范围内参与处理。</p>
			</LegalSection>
			<LegalSection title="你的选择">
				<ul>
					<li>你可以查看、更正或删除账号相关信息。</li>
					<li>你可以关闭个性化记忆，或删除聊天记录。</li>
					<li>你可以通过反馈入口提交注销或数据处理请求。</li>
				</ul>
			</LegalSection>
			<LegalSection title="保存期限与本地存储">
				<p>信息会按账号、问答、安全和运行维护需要保存，不承诺无限期保存。</p>
				<p>浏览器 Cookie 和 local storage 用于登录状态、基础功能和页面运行。</p>
			</LegalSection>
			<LegalSection title="未成年人">
				<p>未成年人使用服务时，应在监护人指导下理解服务边界和个人信息处理方式。</p>
			</LegalSection>
		</LegalDocumentShell>
	);
}

function LegalDocumentShell({
	children,
	peerHref,
	peerLabel,
	title,
}: {
	children: ReactNode;
	peerHref: string;
	peerLabel: string;
	title: string;
}) {
	return (
		<section className="mx-auto max-w-[var(--layout-page-form-width)] px-4 py-6 pb-24 lg:px-6">
			<ProductBrandLink className="mb-8" />
			<p className="text-sm font-medium text-[var(--sys-text-muted)]">生效日期：{EFFECTIVE_DATE}</p>
			<h1 className="mt-1 text-2xl font-semibold tracking-normal text-[var(--sys-text-strong)] md:text-3xl">
				{title}
			</h1>
			<Separator className="mt-5" />
			<Card className="mt-5 p-5 md:p-7">
				<div className="space-y-7 text-sm leading-7 text-[var(--sys-text-muted)]">
					{children}
					<div className="border-t border-border pt-5">
						<p>
							如需联系服务维护者，请通过
							<Button asChild className="mx-1 h-auto min-h-0 px-0" variant="link">
								<Link search={{ source: "legal" }} to="/feedback">
									反馈
								</Link>
							</Button>
							提交说明。你也可以查看
							<Button asChild className="mx-1 h-auto min-h-0 px-0" variant="link">
								<Link to={peerHref}>{peerLabel}</Link>
							</Button>
							。
						</p>
					</div>
				</div>
			</Card>
		</section>
	);
}

function LegalSection({ children, title }: { children: ReactNode; title: string }) {
	return (
		<section className="space-y-2">
			<h2 className="text-base font-semibold text-[var(--sys-text-strong)]">{title}</h2>
			<div className="space-y-2 [&_li]:ml-5 [&_li]:list-disc">{children}</div>
		</section>
	);
}
