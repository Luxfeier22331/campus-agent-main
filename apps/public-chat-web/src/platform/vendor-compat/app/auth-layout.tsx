import type { ReactNode } from "react";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

import { SparklesIcon } from "@/components/chat/icons";

export default function AuthLayout(props: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-muted/20">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-6 md:px-10 md:py-10">
        <Link
          className="flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          href="/"
        >
          <ArrowLeftIcon className="size-3.5" />
          返回首页
        </Link>

        <div className="flex flex-1 items-center justify-center py-8 md:py-12">
          <div className="w-full max-w-[440px]">
            <section className="rounded-[28px] border border-border/50 bg-background px-6 py-8 shadow-sm md:px-8 md:py-10">
              <div className="mb-8 flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm">
                  <SparklesIcon size={16} />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">校园助理</span>
                  <span className="text-xs text-muted-foreground">账号服务</span>
                </div>
              </div>

              <div className="flex flex-col gap-2">{props.children}</div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
