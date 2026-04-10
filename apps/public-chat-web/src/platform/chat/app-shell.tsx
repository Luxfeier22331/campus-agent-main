import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { AppSidebar } from "@/components/chat/app-sidebar";
import { DataStreamProvider } from "@/components/chat/data-stream-provider";
import { ChatShell } from "@/components/chat/shell";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActiveChatProvider } from "@platform/chat/use-active-chat";
import { useChatbotShellRuntime } from "@platform/chat/runtime";
import type { ShellChatUser } from "@platform/chat/types";

function readDefaultSidebarOpen() {
  if (typeof document === "undefined") {
    return true;
  }

  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("sidebar_state="));

  return cookie ? cookie.slice("sidebar_state=".length) === "true" : true;
}

function ChatShellFrame(props: {
  children: ReactNode;
  user: ShellChatUser | undefined;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange enableSystem>
      <TooltipProvider>
        <DataStreamProvider>
          <SidebarProvider defaultOpen={readDefaultSidebarOpen()}>
            <AppSidebar user={props.user} />
            <SidebarInset>
              <Toaster
                position="top-center"
                theme="system"
                toastOptions={{
                  className:
                    "!bg-card !text-foreground !border-border/50 !shadow-[var(--shadow-float)]",
                }}
              />
              {props.children}
            </SidebarInset>
          </SidebarProvider>
        </DataStreamProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export function ChatAppShell() {
  const { session } = useChatbotShellRuntime();

  if (session.kind === "authenticated") {
    const user: ShellChatUser = {
      email: session.principal.email,
      name: session.principal.displayName,
    };

    return (
      <ChatShellFrame user={user}>
        <ActiveChatProvider>
          <ChatShell />
        </ActiveChatProvider>
      </ChatShellFrame>
    );
  }

  throw new Error("ChatAppShell rendered outside authenticated chat route ownership.");
}
