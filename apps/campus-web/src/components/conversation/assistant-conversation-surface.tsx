import { Thread, type ThreadConfig } from "@assistant-ui/react-ui";

import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { cn } from "@/lib/utils";

interface AssistantConversationSurfaceProps {
	className?: string;
}

export function AssistantConversationSurface({
	className,
}: AssistantConversationSurfaceProps = {}) {
	return (
		<section aria-label="校园问答" className={cn("h-full min-h-0 bg-background", className)}>
			<Thread {...campusThreadConfig} />
		</section>
	);
}

export const campusThreadConfig = {
	assistantAvatar: {
		fallback: "问",
	},
	assistantMessage: {
		allowFeedbackNegative: false,
		allowFeedbackPositive: false,
		allowSpeak: false,
		components: {
			ToolFallback,
		},
	},
	composer: {
		allowAttachments: true,
	},
	strings: {
		assistantMessage: {
			copy: {
				tooltip: "复制",
			},
			reload: {
				tooltip: "重新生成",
			},
		},
		branchPicker: {
			next: {
				tooltip: "下一条",
			},
			previous: {
				tooltip: "上一条",
			},
		},
		code: {
			header: {
				copy: {
					tooltip: "复制代码",
				},
			},
		},
		composer: {
			addAttachment: {
				tooltip: "添加附件",
			},
			cancel: {
				tooltip: "停止生成",
			},
			input: {
				placeholder: "输入校园问题",
			},
			removeAttachment: {
				tooltip: "移除附件",
			},
			send: {
				tooltip: "发送",
			},
		},
		editComposer: {
			cancel: {
				label: "取消",
			},
			send: {
				label: "更新",
			},
		},
		thread: {
			scrollToBottom: {
				tooltip: "滚动到底部",
			},
		},
		threadList: {
			item: {
				archive: {
					tooltip: "归档",
				},
				title: {
					fallback: "新对话",
				},
			},
			new: {
				label: "新对话",
			},
		},
		userMessage: {
			edit: {
				tooltip: "编辑",
			},
		},
		welcome: {
			message: "今天想了解什么校园信息？",
		},
	},
	welcome: {
		message: "今天想了解什么校园信息？",
	},
} satisfies ThreadConfig;
