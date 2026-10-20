"use client";

import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { isSafeHref } from "@/lib/safe-markdown";
import { splitTakeV2AnswerBodyAndFooter } from "@/desk/lib/split-take-v2-answer";

const ALLOWED = [
  "p", "strong", "em", "ul", "ol", "li", "br", "code", "a",
  "table", "thead", "tbody", "tr", "th", "td",
] as const;

const markdownComponents = {
  p: (props: ComponentProps<"p">) => <p className="mb-2 last:mb-0" {...props} />,
  ul: (props: ComponentProps<"ul">) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0" {...props} />,
  ol: (props: ComponentProps<"ol">) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0" {...props} />,
  strong: (props: ComponentProps<"strong">) => <strong className="font-semibold" {...props} />,
  a: ({ href, children, ...props }: ComponentProps<"a"> & { href?: string }) =>
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
  table: (props: ComponentProps<"table">) => (
    <div className="my-3 -mx-1 overflow-x-auto overscroll-x-contain">
      <table className="min-w-full border-collapse text-xs tabular-nums" {...props} />
    </div>
  ),
  thead: (props: ComponentProps<"thead">) => <thead className="border-b border-border text-quiet" {...props} />,
  th: (props: ComponentProps<"th">) => (
    <th
      className="whitespace-nowrap px-2 py-1.5 text-right font-medium first:text-left first:pl-0 last:pr-0"
      {...props}
    />
  ),
  td: (props: ComponentProps<"td">) => (
    <td
      className="whitespace-nowrap px-2 py-1.5 text-right first:text-left first:pl-0 last:pr-0"
      {...props}
    />
  ),
  tr: (props: ComponentProps<"tr">) => <tr className="border-b border-border/60 last:border-0" {...props} />,
};

/** GFM tables for v2 take; sources footer in a closed-by-default disclosure. */
export function DeskTakeV2AnswerMarkdown({ content }: { content: string }) {
  const { body, footerLines } = splitTakeV2AnswerBodyAndFooter(content);
  return (
    <div data-testid="desk-take-v2-markdown" className="desk-take-v2-answer-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        allowedElements={[...ALLOWED]}
        unwrapDisallowed
        components={markdownComponents}
      >
        {body}
      </ReactMarkdown>
      {footerLines.length > 0 ? (
        <details data-testid="desk-take-v2-sources" className="mt-3 group">
          <summary className="cursor-pointer text-2xs text-subtle hover:text-quiet list-none [&::-webkit-details-marker]:hidden">
            Sources
          </summary>
          <div className="mt-1.5 space-y-1 text-2xs leading-relaxed text-subtle">
            {footerLines.map((line) => (
              <p key={line} data-testid="desk-take-v2-source-line" className="m-0">
                {line}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
