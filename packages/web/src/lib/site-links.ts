const PUBLISHED_DOCS_URL = "https://pundit.gitbook.io/pundit-docs/";
const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL?.trim() || PUBLISHED_DOCS_URL;
const GITHUB_URL = "https://github.com/fenomenocap/pundit";

export function getDocsUrl(): string {
  return DOCS_URL;
}

export function getGithubUrl(): string {
  return GITHUB_URL;
}

export { DOCS_URL, GITHUB_URL };
