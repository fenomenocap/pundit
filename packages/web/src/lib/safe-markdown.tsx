"use client";

import ReactMarkdown from "react-markdown";

export function isSafeHref(href: string | undefined): boolean {
  if (!href) return false;
  try {
    return ["http:", "https:"].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

export function SafeMarkdown({
  content,
  paragraphClassName = "mb-2 last:mb-0",
  linkClassName = "text-cyan-400 underline decoration-cyan-400/40 underline-offset-2 hover:decoration-cyan-400",
  strongClassName = "font-semibold text-white",
}: {
  content: string;
  paragraphClassName?: string;
  linkClassName?: string;
  strongClassName?: string;
}) {
  return (
    <ReactMarkdown
      allowedElements={["p", "strong", "em", "ul", "ol", "li", "br", "code", "a"]}
      unwrapDisallowed
      components={{
        p: (props) => <p className={paragraphClassName} {...props} />,
        ul: (props) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0" {...props} />,
        ol: (props) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0" {...props} />,
        strong: (props) => <strong className={strongClassName} {...props} />,
        a: ({ href, children, ...props }) =>
          isSafeHref(href) ? (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={linkClassName}
            >
              {children}
            </a>
          ) : (
            <>{children}</>
          ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
