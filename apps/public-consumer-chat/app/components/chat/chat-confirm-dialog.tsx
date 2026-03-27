import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const EASE_STANDARD = [0.22, 1, 0.36, 1] as const;

export function ChatConfirmDialog(props: Readonly<{
  actionLabel: string;
  children: ReactNode;
  description: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  open: boolean;
  title: string;
}>) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {props.open ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="chatbot-dialog-backdrop"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          role="presentation"
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.16, ease: EASE_STANDARD }}
        >
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            aria-labelledby="chat-confirm-dialog-title"
            aria-modal="true"
            className="chatbot-dialog"
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.99, y: 6 }}
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.985, y: 8 }}
            role="dialog"
            transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.22, ease: EASE_STANDARD }}
          >
            <h2 id="chat-confirm-dialog-title">{props.title}</h2>
            <p>{props.description}</p>
            {props.children}
            <div className="chatbot-dialog-actions">
              <button className="chat-sidebar-secondary-action" onClick={props.onCancel} type="button">
                Cancel
              </button>
              <button
                className="chatbot-danger-button"
                onClick={() => {
                  void props.onConfirm();
                }}
                type="button"
              >
                {props.actionLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
