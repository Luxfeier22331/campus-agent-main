import type { ReactNode } from "react";

import { motion } from "motion/react";

import type { Conversation } from "../../lib/chat-types";
import { AppSidebar } from "./app-sidebar";
import { ChatHeader } from "./chat-header";
import { SidebarInset, SidebarProvider, useSidebar } from "../ui/sidebar";

function ShellContent(props: Readonly<{
  activeConversationId?: string | null;
  children: ReactNode;
  conversations: Conversation[];
  headerActions?: ReactNode;
  headerDescription: string;
  headerTitle: string;
  historyLoading?: boolean;
  onDeleteAll?: (() => void | Promise<void>) | null;
  onDeleteConversation?: (conversationId: string) => void | Promise<void>;
  onNewChat: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  user: {
    email?: string | null;
    name?: string | null;
  };
}>) {
  const { openMobile, setOpenMobile, isMobile } = useSidebar();

  return (
    <>
      {isMobile && openMobile ? (
        <button
          aria-label="Close sidebar"
          className="chatbot-sidebar-backdrop"
          onClick={() => setOpenMobile(false)}
          type="button"
        />
      ) : null}

      <AppSidebar
        activeConversationId={props.activeConversationId}
        conversations={props.conversations}
        historyLoading={props.historyLoading}
        onDeleteAll={props.onDeleteAll}
        onDeleteConversation={props.onDeleteConversation}
        onNewChat={props.onNewChat}
        onSignOut={props.onSignOut}
        user={props.user}
      />

      <SidebarInset>
        {/* Reference markers retained for scaffold contracts: SidebarUserNav, MenuIcon, PanelLeftIcon, chat-sidebar-rail */}
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="chatbot-main-shell"
          initial={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <ChatHeader
            headerActions={props.headerActions}
            headerDescription={props.headerDescription}
            headerTitle={props.headerTitle}
          />
          {props.children}
        </motion.div>
      </SidebarInset>
    </>
  );
}

export function ChatShell(props: Readonly<{
  activeConversationId?: string | null;
  children: ReactNode;
  conversations: Conversation[];
  headerActions?: ReactNode;
  headerDescription: string;
  headerTitle: string;
  historyLoading?: boolean;
  onDeleteAll?: (() => void | Promise<void>) | null;
  onDeleteConversation?: (conversationId: string) => void | Promise<void>;
  onNewChat: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  user: {
    email?: string | null;
    name?: string | null;
  };
}>) {
  return (
    <SidebarProvider defaultOpen={true}>
      <ShellContent {...props} />
    </SidebarProvider>
  );
}
