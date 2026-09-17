import { Button, Card, Separator } from "@campus-agent/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const EFFECTIVE_DATE = "2026-09-14";

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
				<p>
					你需要对通过账号提交的内容负责，包括问题、反馈、食堂投稿、菜品评价和其他主动输入的信息。
				</p>
			</LegalSection>
			<LegalSection title="食堂用户投稿">
				<p>
					用户投稿由用户提供，与食堂正式菜单不同，名称、价格和照片仅供参考。公开投稿会显示作者展示名。
				</p>
				<p>
					你可以编辑或删除自己的投稿。内容维护人员可以隐藏、删除投稿，或在允许的期限内恢复投稿，但不会代作者修改投稿正文。
				</p>
				<p>
					请只提交你有权使用的照片和信息。照片经过检查和规范化处理后展示，服务不保存原始上传文件。
				</p>
				<p>
					隐藏、删除或申请注销后，投稿停止公开；这不表示所有数据已立即删除，也无法收回其他用户已经下载的内容。
				</p>
			</LegalSection>
			<LegalSection title="菜品评价">
				<p>
					菜品评价会公开展示。你可以选择公开署名或公开匿名；公开匿名不会向其他学生显示你的名称，
					但获准内容维护人员仍可查看提交账号。
				</p>
				<p>
					你可以删除自己的评价，也可以举报他人的评价。为处理不当内容和纠正正文，内容维护人员可以
					隐藏评价或修改正文，修改前后的内容和操作信息会保留。
				</p>
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
					<li>
						食堂投稿名称、价格、规范化照片、编辑前后内容，以及菜品评价、匿名选择、举报和处理记录。
					</li>
					<li>个性化记忆或偏好摘要。</li>
					<li>安全验证结果、日志、错误信息和基础设备信息。</li>
				</ul>
			</LegalSection>
			<LegalSection title="处理目的">
				<ul>
					<li>提供注册、登录、密码重置和账号服务。</li>
					<li>提供问答、聊天记录、食堂投稿与评价和个性化体验。</li>
					<li>处理投稿照片、执行提交次数限制、识别重复请求、处理举报和争议、保留必要修改记录。</li>
					<li>进行安全防护、故障排查和服务改进。</li>
				</ul>
			</LegalSection>
			<LegalSection title="公开内容与身份">
				<p>
					公开投稿显示提交作者的展示名，不提供匿名投稿。评价的公开匿名选项不代表对内容维护人员匿名。
				</p>
				<p>
					公开署名评价会显示提交时的名称；公开匿名评价不显示名称。无论选择哪种方式，服务都会保存
					提交账号，获准内容维护人员可以在处理评价和举报时查看。
				</p>
				<p>内容维护人员修改评价正文时，服务会保存修改前后正文、操作人员和时间。</p>
			</LegalSection>
			<LegalSection title="第三方服务">
				<p>
					服务可能使用 Cloudflare Turnstile 进行安全验证，使用 AI 模型服务生成或整理回答，使用
					邮件服务发送账号相关邮件，使用图片处理服务检查和规范化投稿照片，并依赖云存储、云基础设施和内容分发服务提供页面与数据访问。
				</p>
				<p>这些服务只在完成上述功能所需范围内参与处理。</p>
			</LegalSection>
			<LegalSection title="你的选择">
				<ul>
					<li>你可以查看、更正或删除账号相关信息。</li>
					<li>你可以关闭个性化记忆，或删除聊天记录。</li>
					<li>你可以编辑或删除自己的投稿，删除自己的菜品评价，或举报他人的投稿和评价。</li>
					<li>你可以在账号设置中验证当前密码并申请注销；其他数据处理请求可以通过反馈入口提交。</li>
				</ul>
			</LegalSection>
			<LegalSection title="保存期限与本地存储">
				<p>信息会按账号、问答、安全和运行维护需要保存，不承诺无限期保存。</p>
				<p>
					已删除或已隐藏的菜品评价仍会保留，用于执行每日提交次数限制、处理争议和核对操作记录；
					这些内容不再向学生公开。
				</p>
				<ul>
					<li>公开投稿和当前照片长期保存；隐藏不会启动自动删除期限。</li>
					<li>
						删除投稿后保留 30
						天。只有内容维护人员可以在到期前且尚未开始清理时恢复；到期后清理正文和照片，不再恢复。
					</li>
					<li>被替换的文字历史和退出当前引用的照片，自替换或移除时保留 30 天，到期后清理。</li>
					<li>
						举报详情和举报时的内容自受理起最多保留 30
						天，结案不延长期限；内容到期不等于举报已结案。更早到期的删除、照片或注销期限优先。
					</li>
					<li>
						投稿最终清理后，其下其他人的评价仅供内容维护人员处理，再保留 30
						天后清理。举报去重和最小处理记录保留至目标内容清理，必要引用解除后删除无内容占位。
					</li>
					<li>
						注销受理后立即撤下投稿，后台立即开始清理，并在 30
						天内清除投稿和照片、本人评价，以及举报和历史中可关联账号的身份。只有所需内容与照片删除完成后才完成注销，不会为此固定等待
						30 天。
					</li>
				</ul>
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
		<section className="mx-auto min-h-[calc(100dvh-var(--layout-campus-topnav-height))] max-w-[var(--layout-page-form-width)] px-4 py-6 pb-24 lg:px-6">
			<p className="text-sm font-medium text-[var(--sys-text-muted)]">生效日期：{EFFECTIVE_DATE}</p>
			<h1 className="mt-1 ui-page-title">{title}</h1>
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
