import { Compass, Plus } from "lucide-react";

import { Button } from "./ui/button";

interface ChatbotEmptyStateProps {
  busy?: boolean;
  error?: string | null;
  onCreateDraft: () => void;
}

export function ChatbotEmptyState({
  busy = false,
  error,
  onCreateDraft,
}: ChatbotEmptyStateProps) {
  return (
    <section className="rounded-[2rem] border border-chat-border bg-white/95 p-6 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-chat-accent">New chat</p>
          <div className="space-y-2">
            <h3 className="font-serif text-3xl leading-none text-balance text-chat-ink">
              Ask a campus question in one step.
            </h3>
            <p className="text-pretty text-sm leading-6 text-chat-muted">
              Questions sent here go through the shared app-api command path. You can ask directly from an empty state or create a draft thread first if you want a saved conversation before the first send.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-start">
          <div className="flex size-14 items-center justify-center rounded-full border border-chat-accent/30 bg-chat-accent-soft text-chat-accent-strong">
            <Compass className="size-6" />
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button disabled={busy} onClick={onCreateDraft} type="button" variant="secondary">
          Create empty draft
          <Plus className="size-4" />
        </Button>
        <p className="text-sm text-chat-muted">Saved threads stay attached to the same signed-in app principal.</p>
      </div>

      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
    </section>
  );
}
