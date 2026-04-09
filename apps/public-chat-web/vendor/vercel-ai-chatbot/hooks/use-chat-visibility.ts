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
        toast.info("Chat sharing is not available in campus mode yet.");
      }
    },
  };
}
