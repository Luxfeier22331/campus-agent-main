import { SendHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "./ui/button";

interface ChatbotComposerProps {
  disabled?: boolean;
  draftKey: string;
  placeholder: string;
  supportingText?: string;
  submitting?: boolean;
  submitLabel?: string;
  defaultValue?: string;
  onSubmit: (prompt: string) => Promise<boolean>;
}

export function ChatbotComposer({
  defaultValue = "",
  disabled = false,
  draftKey,
  onSubmit,
  placeholder,
  supportingText = "Keep requests specific for better grounding and safer clarification behavior.",
  submitLabel = "Send",
  submitting = false,
}: ChatbotComposerProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue, draftKey]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    const success = await onSubmit(normalized);
    if (success) {
      setValue("");
    }
  };

  return (
    <form
      className="rounded-[2rem] border border-chat-border bg-chat-panel p-4 shadow-sm"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="sr-only" htmlFor="chatbot-composer">
            Chat composer
          </label>
          <textarea
            className="min-h-32 w-full resize-none rounded-[1.5rem] border border-chat-border bg-white px-4 py-4 text-[15px] leading-7 text-chat-ink outline-none placeholder:text-chat-muted focus:border-chat-accent/45"
            disabled={disabled}
            id="chatbot-composer"
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            value={value}
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-sm text-chat-muted">{supportingText}</p>
          <Button
            className="sm:self-end"
            disabled={disabled || submitting}
            type="submit"
            variant="primary"
          >
            {submitting ? "Sending..." : submitLabel}
            <SendHorizontal className="size-4" />
          </Button>
        </div>
      </div>
    </form>
  );
}
