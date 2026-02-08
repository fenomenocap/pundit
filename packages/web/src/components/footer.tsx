import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-8 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
        <p className="text-sm text-slate-500">
          Built on{" "}
          <span className="font-medium text-blue-400">Base</span>
        </p>

        <div className="flex items-center gap-6">
          <Link
            href="https://x.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-slate-500 transition-colors hover:text-slate-300"
          >
            Twitter
          </Link>
          <Link
            href="https://discord.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-slate-500 transition-colors hover:text-slate-300"
          >
            Discord
          </Link>
          <Link
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-slate-500 transition-colors hover:text-slate-300"
          >
            GitHub
          </Link>
        </div>
      </div>
    </footer>
  );
}
