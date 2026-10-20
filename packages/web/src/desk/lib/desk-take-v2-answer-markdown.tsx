"use client";

import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { isSafeHref } from "@/lib/safe-markdown";
import { prepareTakeV2DeskMarkdown } from "@/desk/lib/prepare-take-v2-desk-markdown";

const ALLOWED = [
  "p", "strong", "em", "ul", "ol", "li", "br", "code", "a",
  "table", "thead", "tbody", "tr", "th", "td",
] as const;

/** GFM tables + line breaks for v2 take footers (single-newline source lines). */
export function DeskTakeV2AnswerMarkdown({ content }: { content: string }) {
  const markdown = prepareTakeV2DeskMarkdown(content);
  return (
    <div
      data-testid="desk-take-v2-markdown"
      className="desk-take-v2-answer-md [&_table~p]:text-2xs [&_table~p]:leading-relaxed [&_table~p]:text-subtle"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        allowedElements={[...ALLOWED]}
        unwrapDisallowed
        components={{
          p: (props) => <p className="mb-2 last:mb-0" {...props} />,
          ul: (props) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0" {...props} />,
          ol: (props) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0" {...props} />,
          strong: (props) => <strong className="font-semibold" {...props} />,
          a: ({ href, children, ...props }) =>
            isSafeHref(href) ? (
              <a
                {...props}
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
              >
                {children}
              </a>
            ) : (
              <>{children}</>
            ),
          table: (props) => (
            <div className="my-3 -mx-1 overflow-x-auto overscroll-x-contain">
              <table className="min-w-full border-collapse text-xs tabular-nums" {...props} />
            </div>
          ),
          thead: (props) => <thead className="border-b border-border text-quiet" {...props} />,
          th: (props) => (
            <th
              className="whitespace-nowrap px-2 py-1.5 text-right font-medium first:text-left first:pl-0 last:pr-0"
              {...props}
            />
          ),
          td: (props) => (
            <td
              className="whitespace-nowrap px-2 py-1.5 text-right first:text-left first:pl-0 last:pr-0"
              {...props}
            />
          ),
          tr: (props) => <tr className="border-b border-border/60 last:border-0" {...props} />,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
