import { memo } from "react";

import { motion, useReducedMotion } from "motion/react";

const SUGGESTIONS = [
  "图书馆今天开放到几点？",
  "本周校医院门诊时间是什么？",
  "宿舍报修应该怎么提交？",
  "选课冲突要去哪里处理？",
];

const EASE_STANDARD = [0.22, 1, 0.36, 1] as const;

function PureSuggestedActions(props: Readonly<{
  onSelect: (suggestion: string) => void | Promise<unknown>;
}>) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="chatbot-suggested-actions" data-testid="suggested-actions">
      {SUGGESTIONS.map((suggestion, index) => (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="chatbot-suggested-action-wrap"
          initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
          key={suggestion}
          transition={{
            delay: 0.06 * index,
            duration: prefersReducedMotion ? 0 : 0.4,
            ease: EASE_STANDARD,
          }}
        >
          <button
            className="chatbot-suggested-action"
            onClick={() => {
              void props.onSelect(suggestion);
            }}
            type="button"
          >
            {suggestion}
          </button>
        </motion.div>
      ))}
    </div>
  );
}

export const SuggestedActions = memo(PureSuggestedActions);
