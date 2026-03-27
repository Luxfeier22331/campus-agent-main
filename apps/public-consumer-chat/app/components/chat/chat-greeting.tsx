import { motion, useReducedMotion } from "motion/react";

const EASE_STANDARD = [0.22, 1, 0.36, 1] as const;

export function ChatGreeting(props: Readonly<{
  disabled?: boolean;
  error?: string | null;
}>) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section className="chatbot-greeting">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="chatbot-greeting-title"
        initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
        transition={prefersReducedMotion ? { duration: 0 } : { delay: 0.35, duration: 0.5, ease: EASE_STANDARD }}
      >
        What can I help with?
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="chatbot-greeting-subtitle"
        initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
        transition={prefersReducedMotion ? { duration: 0 } : { delay: 0.5, duration: 0.5, ease: EASE_STANDARD }}
      >
        Ask a grounded campus question or explore a campus workflow.
      </motion.div>
      {props.error ? (
        <p className="chatbot-inline-error chatbot-thread-error" role="alert">
          {props.error}
        </p>
      ) : null}
      {props.disabled ? <span className="sr-only">Submitting prompt</span> : null}
    </section>
  );
}
