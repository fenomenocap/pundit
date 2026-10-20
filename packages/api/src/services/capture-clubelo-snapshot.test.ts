import { describe, expect, it } from "vitest";
import {
  EPL_CLUB_PAGE_SLUGS,
  parseClubEloClubPageHtml,
  parseClubEloCsv,
  parseClubEloRankingHtml,
} from "./clubelo-capture-parsers";

describe("capture-clubelo-snapshot parsers", () => {
  it("parses club page Elo and ranking date", () => {
    const html = `
      <h1><a href="/2026-10-19/Arsenal">Arsenal</a></h1>
      <p>Elo: <b>2048.12</b></p>
    `;
    expect(parseClubEloClubPageHtml(html)).toEqual({
      club: "Arsenal",
      elo: 2048.12,
      rankingDate: "2026-10-19",
    });
  });

  it("lists twenty current EPL club page slugs", () => {
    expect(EPL_CLUB_PAGE_SLUGS).toHaveLength(20);
    expect(EPL_CLUB_PAGE_SLUGS.map((row) => row.slug)).toContain("Forest");
  });

  it("parses CSV rows", () => {
    const csv = "Rank,Club,Country,Level,Elo,From,To\n1,Arsenal,ENG,1,2048,2026-10-13,2026-10-19,2026-10-19,2026-10-19 00:00:00\n";
    const rows = parseClubEloCsv(csv);
    expect(rows).toEqual([{ club: "Arsenal", country: "ENG", elo: 2048 }]);
  });

  it("parses ranking HTML table rows with vega precision", () => {
    const html = `
      {"Colour":"#fff","Name":"Arsenal","Elo":2048.5}
      <tr><td><img alt="ENG" /><a href="/Arsenal"><span class="NonAst">A</span><span class="Ast">Arsenal</span></a></td><td class="r">2048</td></tr>
    `;
    const rows = parseClubEloRankingHtml(html);
    expect(rows).toEqual([{ club: "Arsenal", country: "ENG", elo: 2048.5 }]);
  });
});
