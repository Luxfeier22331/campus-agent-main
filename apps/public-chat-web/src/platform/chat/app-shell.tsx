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

export function ChatAppShell() {
  const { session } = useChatbotShellRuntime();
  const user: ShellChatUser | undefined =
    session.kind === "authenticated"
      ? {
          email: session.principal.email,
          name: session.principal.displayName,
        }
      : undefined;

  return (
    <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange enableSystem>
      <TooltipProvider>
        <DataStreamProvider>
          <SidebarProvider defaultOpen={readDefaultSidebarOpen()}>
            <AppSidebar user={user} />
            <SidebarInset>
              <Toaster
                position="top-center"
                theme="system"
                toastOptions={{
                  className:
                    "!bg-card !text-foreground !border-border/50 !shadow-[var(--shadow-float)]",
                }}
              />
              <ActiveChatProvider>
                <ChatShell />
              </ActiveChatProvider>
            </SidebarInset>
          </SidebarProvider>
        </DataStreamProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
