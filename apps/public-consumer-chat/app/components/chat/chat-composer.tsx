import { useEffect, useRef, useState } from "react";

import { SendIcon } from "./chat-icons";
import { SuggestedActions } from "./suggested-actions";

const STORAGE_PREFIX = "public-consumer-chat:draft:";

function readStoredDraft(draftKey: string): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(`${STORAGE_PREFIX}${draftKey}`) ?? "";
}

function writeStoredDraft(draftKey: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = `${STORAGE_PREFIX}${draftKey}`;
  if (value.trim()) {
    window.localStorage.setItem(storageKey, value);
    return;
  }

  window.localStorage.removeItem(storageKey);
}

export function ChatComposer(props: Readonly<{
  actionLabel?: string;
  draftKey: string;
  onSubmit: (prompt: string) => Promise<boolean>;
  placeholder: string;
  submitting?: boolean;
}>) {
  const [value, setValue] = useState("");
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const isNewConversation = props.draftKey === "new";

  useEffect(() => {
    setValue(readStoredDraft(props.draftKey));
  }, [props.draftKey]);

  useEffect(() => {
    writeStoredDraft(props.draftKey, value);
  }, [props.draftKey, value]);

  useEffect(() => {
    const element = textAreaRef.current;
    if (!element) {
      return;
    }

    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [value]);

  useEffect(() => {
    textAreaRef.current?.focus();
  }, [props.draftKey]);

  const submit = async (nextValue = value) => {
    const normalized = nextValue.trim();
    if (!normalized || props.submitting) {
      return;
    }

    const didSucceed = await props.onSubmit(normalized);
    if (didSucceed) {
      setValue("");
      writeStoredDraft(props.draftKey, "");
    }
  };

  return (
    <div className="chatbot-composer-shell">
      {isNewConversation && !value.trim() ? (
        <SuggestedActions
          onSelect={(suggestion) => {
            void submit(suggestion);
          }}
        />
      ) : null}

      <div className="chatbot-composer-card" data-testid="multimodal-input">
        <label className="sr-only" htmlFor={`chat-composer-${props.draftKey}`}>
          Message
        </label>
        <textarea
          autoComplete="off"
          className="chatbot-composer-input"
          id={`chat-composer-${props.draftKey}`}
          name="prompt"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={props.placeholder}
          ref={textAreaRef}
          rows={1}
          value={value}
        />

        <div className="chatbot-composer-footer">
          <span className="chatbot-composer-meta">Shift+Enter for a new line</span>
          <button
            aria-label={props.submitting ? "Waiting for response" : props.actionLabel ?? "Send"}
            className="chatbot-submit-button"
            disabled={props.submitting || !value.trim()}
            onClick={() => {
              void submit();
            }}
            type="button"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
