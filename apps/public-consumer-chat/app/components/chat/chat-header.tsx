import { memo } from "react";

import { useSidebar } from "../ui/sidebar";
import { PanelLeftIcon } from "./chat-icons";

function PureChatHeader(props: Readonly<{
  headerActions?: React.ReactNode;
  headerDescription: string;
  headerTitle: string;
}>) {
  const { state, toggleSidebar, isMobile } = useSidebar();

  if (state === "collapsed" && !isMobile) {
    return null;
  }

  return (
    <header className="chatbot-main-header">
      <div className="chatbot-main-header-left">
        <button
          aria-label="Open sidebar"
          className="chatbot-mobile-menu"
          onClick={toggleSidebar}
          type="button"
        >
          <PanelLeftIcon direction="expand" />
        </button>
      </div>

      <div className="chatbot-main-header-right">
        {props.headerTitle === "New chat" ? null : (
          <div className="chatbot-main-header-copy">
            <span className="chatbot-main-title">{props.headerTitle}</span>
            {props.headerDescription ? (
              <span className="chatbot-main-subtitle">{props.headerDescription}</span>
            ) : null}
          </div>
        )}
        {props.headerActions}
      </div>
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader);
