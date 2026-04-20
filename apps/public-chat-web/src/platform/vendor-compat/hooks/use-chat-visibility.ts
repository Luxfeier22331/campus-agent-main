"use client";

import { toast } from "sonner";

import type { VisibilityType } from "@/components/chat/visibility-selector";

export function useChatVisibility({
  chatId: _chatId,
  initialVisibilityType,
}: {
  chatId: string;
  initialVisibilityType: VisibilityType;
}) {
  return {
    visibilityType: initialVisibilityType,
    setVisibilityType(nextVisibilityType: VisibilityType) {
      if (nextVisibilityType !== initialVisibilityType) {
        toast.info("校园模式暂未开放对话分享。");
      }
    },
  };
}
