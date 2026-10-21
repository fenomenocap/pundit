import fs from "node:fs";
import path from "node:path";

export interface SourceGroupDefinition {
  primary: string | null;
  fallback: string | null;
  corroborateOnly: string[];
  searchAllowed: boolean;
  queryTemplate: string;
}

const sourceGroupsJson = JSON.parse(fs.readFileSync(
  path.join(__dirname, "../../../../data/match-dossier/source-groups.json"),
  "utf8",
)) as { groups: Record<string, SourceGroupDefinition>; rules: string[]; enforcement: Record<string, string> };

export type SourceGroupKey = keyof typeof sourceGroupsJson.groups;

const catalog = sourceGroupsJson as {
  groups: Record<string, SourceGroupDefinition>;
  rules: string[];
  enforcement: Record<string, string>;
};

export function sourceGroupForField(fieldKey: "fixtureIdentity" | "teamNews"): SourceGroupKey {
  if (fieldKey === "fixtureIdentity") return "fixture_identity";
  return "injuries_doubts";
}

export function getSourceGroup(key: SourceGroupKey): SourceGroupDefinition {
  return catalog.groups[key];
}

export function formatGroupQueryTemplate(
  template: string,
  params: { home: string; away: string; competition: string; kickoffDate: string },
): string {
  return template
    .replaceAll("{home}", params.home)
    .replaceAll("{away}", params.away)
    .replaceAll("{competition}", params.competition)
    .replaceAll("{kickoff_date}", params.kickoffDate);
}

export function sourceGroupsRules(): string[] {
  return catalog.rules;
}
