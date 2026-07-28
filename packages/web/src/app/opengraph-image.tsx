import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Pundit — club-season football analysis";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0a1628 0%, #0f1f35 50%, #0a1628 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 96,
            fontWeight: 700,
            color: "#22d3ee",
            letterSpacing: "-0.02em",
          }}
        >
          Pundit
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 32,
            color: "#94a3b8",
            textAlign: "center",
            maxWidth: 900,
            lineHeight: 1.4,
          }}
        >
          Premier League &amp; UCL qualifier analysis grounded in Pundit&apos;s model
        </div>
      </div>
    ),
    { ...size }
  );
}
