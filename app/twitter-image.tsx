import { ImageResponse } from "next/og";

export const alt = "Info Hub";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: "-0.04em",
            fontFamily: "Georgia, serif",
          }}
        >
          INFO HUB
        </div>
        <div style={{ fontSize: 28, marginTop: 24, opacity: 0.8 }}>
          News, sports, markets, media
        </div>
      </div>
    ),
    { ...size },
  );
}
