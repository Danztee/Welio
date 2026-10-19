import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 42,
        background: "#f59b00",
      }}
    >
      <svg width="132" height="132" viewBox="0 0 64 64" fill="none">
        <path
          d="m10 18 11.5 28a4.3 4.3 0 0 0 8 0L32 32.8 34.5 46a4.3 4.3 0 0 0 8 0L54 18"
          stroke="white"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="7"
        />
      </svg>
    </div>,
    size,
  );
}
