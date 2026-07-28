const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL?.trim() || null;
const GITHUB_URL = "https://github.com/fenomenocap/pundit";

export function getDocsUrl(): string | null {
  return DOCS_URL;
}

export function getGithubUrl(): string {
  return GITHUB_URL;
}

export { DOCS_URL, GITHUB_URL };
