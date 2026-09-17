import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Pundit — Premier League and Champions League qualifier analysis";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#07090d";
const CARD = "#0d1118";
const RIM = "#1c2330";
const ACCENT = "#3eff8a";
const FG = "#eef2f6";
const MUTED = "#8a93a3";

// Illustrative layout only — not a live forecast.
const SAMPLE = [
  { label: "HOME", pct: 52, color: ACCENT },
  { label: "DRAW", pct: 26, color: "#5b6576" },
  { label: "AWAY", pct: 22, color: "#39414f" },
];

export default async function OpenGraphImage() {
  const [bold, semibold, body] = await Promise.all([
    fetch(new URL("./_og/BarlowCondensed-Bold.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL("./_og/BarlowCondensed-SemiBold.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL("./_og/Barlow-Medium.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: BG,
          backgroundImage: `radial-gradient(circle at 85% 20%, rgba(62,255,138,0.16), transparent 45%)`,
          padding: "64px 72px",
          fontFamily: "Barlow",
          color: FG,
        }}
      >
        {/* Left: brand + headline */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 10,
                background: ACCENT,
                color: "#06140c",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "Barlow Condensed",
                fontWeight: 700,
                fontSize: 40,
              }}
            >
              P
            </div>
            <div style={{ marginLeft: 18, fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 40, letterSpacing: 2 }}>
              PUNDIT
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                fontFamily: "Barlow Condensed",
                fontWeight: 700,
                fontSize: 104,
                lineHeight: 0.95,
                letterSpacing: 1,
              }}
            >
              <span>ASK THE</span>
              <span style={{ color: ACCENT }}>WEEKEND.</span>
            </div>
            <div style={{ marginTop: 22, fontSize: 28, color: MUTED, maxWidth: 560, lineHeight: 1.35 }}>
              Premier League &amp; UCL qualifier probabilities, market odds and grounded analysis.
            </div>
          </div>

          <div style={{ display: "flex", fontSize: 22, color: MUTED }}>thepundit.vercel.app</div>
        </div>

        {/* Right: model card */}
        <div style={{ display: "flex", alignItems: "center", marginLeft: 48 }}>
          <div
            style={{
              width: 420,
              display: "flex",
              flexDirection: "column",
              background: CARD,
              border: `1px solid ${RIM}`,
              borderRadius: 18,
              padding: 32,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: "Barlow Condensed",
                fontWeight: 600,
                fontSize: 22,
                letterSpacing: 2,
                color: MUTED,
              }}
            >
              <span>MATCH MODEL</span>
              <span style={{ display: "flex", alignItems: "center", color: ACCENT }}>
                <div style={{ display: "flex", width: 10, height: 10, borderRadius: 5, background: ACCENT, marginRight: 8 }} />
                EXAMPLE
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
              {SAMPLE.map((row) => (
                <div key={row.label} style={{ display: "flex", flexDirection: "column", marginBottom: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontFamily: "Barlow Condensed",
                      fontWeight: 600,
                      fontSize: 26,
                    }}
                  >
                    <span style={{ color: MUTED, letterSpacing: 1 }}>{row.label}</span>
                    <span>{row.pct}%</span>
                  </div>
                  <div style={{ display: "flex", marginTop: 8, height: 10, borderRadius: 5, background: "#161c26" }}>
                    <div style={{ display: "flex", width: `${row.pct}%`, height: 10, borderRadius: 5, background: row.color }} />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", marginTop: 6 }}>
              {["1X2", "TOTALS", "BTTS", "SCORELINES"].map((chip) => (
                <div
                  key={chip}
                  style={{
                    display: "flex",
                    marginRight: 8,
                    marginTop: 8,
                    padding: "5px 10px",
                    borderRadius: 999,
                    border: `1px solid ${RIM}`,
                    fontFamily: "Barlow Condensed",
                    fontWeight: 600,
                    fontSize: 17,
                    letterSpacing: 1,
                    color: FG,
                  }}
                >
                  {chip}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Barlow Condensed", data: bold, weight: 700, style: "normal" },
        { name: "Barlow Condensed", data: semibold, weight: 600, style: "normal" },
        { name: "Barlow", data: body, weight: 500, style: "normal" },
      ],
    }
  );
}
