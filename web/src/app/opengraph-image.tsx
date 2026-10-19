import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "88px",
        background: "#f5f6fa",
        color: "#202a35",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div
          style={{
            width: 64,
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 18,
            background: "#f59b00",
          }}
        >
          <svg width="48" height="48" viewBox="0 0 64 64" fill="none">
            <path
              d="m10 18 11.5 28a4.3 4.3 0 0 0 8 0L32 32.8 34.5 46a4.3 4.3 0 0 0 8 0L54 18"
              stroke="white"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="7"
            />
          </svg>
        </div>
        <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -2 }}>
          welio
        </span>
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 56,
          fontSize: 62,
          fontWeight: 600,
          letterSpacing: -2,
        }}
      >
        Manage bookings and customers.
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 22,
          color: "#727b8b",
          fontSize: 28,
        }}
      >
        An AI receptionist answers questions and helps customers book.
      </div>
    </div>,
    size,
  );
}
