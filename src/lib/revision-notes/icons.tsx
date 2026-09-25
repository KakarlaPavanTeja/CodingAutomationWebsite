/** Sketch-style icons for the sticky board (Satori-compatible inline SVG, 48×48 box). */
import type { ReactElement } from "react";
import type { IconName } from "./board";

const INK = "#2b2620";

export function Icon({ name, size }: { name: IconName; size: number }): ReactElement {
  const s = {
    fill: "none",
    stroke: INK,
    strokeWidth: 2.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  let body: ReactElement;
  switch (name) {
    case "bulb":
      body = (
        <g>
          <path d="M24 6c-7.5 0-12.5 5.6-12.5 12.2 0 4.6 2.6 7.6 5 10 1.4 1.4 2 3 2 4.8h11c0-1.8.6-3.4 2-4.8 2.4-2.4 5-5.4 5-10C36.5 11.6 31.5 6 24 6z" fill="#fcd34d" stroke={INK} strokeWidth={2.6} />
          <path d="M19 37.5h10M20 41.5h8" {...s} />
          <path d="M4 18h3M41 18h3M8.5 6.5l2.2 2.2M39.5 6.5l-2.2 2.2" {...s} stroke="#e0a800" />
        </g>
      );
      break;
    case "steps":
      body = (
        <g>
          <path d="M16 12h26M16 24h26M16 36h20" {...s} />
          <circle cx="7" cy="12" r="3" fill={INK} />
          <circle cx="7" cy="24" r="3" fill={INK} />
          <circle cx="7" cy="36" r="3" fill={INK} />
        </g>
      );
      break;
    case "code":
      body = <path d="M16 12L5 24.2 16 36.5M32 12l11 12.2L32 36.5M27.5 8.5L20.5 40" {...s} strokeWidth={3.4} />;
      break;
    case "star":
      body = (
        <path
          d="M24 4.5l5.9 12.3 13.4 1.7-9.8 9.3 2.5 13.3L24 34.6 12 41.1l2.5-13.3-9.8-9.3 13.4-1.7z"
          fill="#fcd34d"
          stroke="#b7791f"
          strokeWidth={2.6}
          strokeLinejoin="round"
        />
      );
      break;
    case "clock":
      body = (
        <g>
          <circle cx="24" cy="24" r="18.5" fill="#ffffff" stroke={INK} strokeWidth={3} />
          <path d="M24 12.5V24l7.5 5" {...s} strokeWidth={3.2} />
        </g>
      );
      break;
    case "chart":
      body = (
        <g>
          <path d="M6 42h37M8 42V6" {...s} />
          <path d="M14 36c6-2 9-10 13-17s8-10 14-11" {...s} stroke="#2b8a3e" strokeWidth={3.4} />
          <path d="M14 14c7 5 14 13 27 20" {...s} stroke="#e8590c" strokeWidth={3} strokeDasharray="4 5" />
        </g>
      );
      break;
    case "play":
      body = (
        <g>
          <circle cx="24" cy="24" r="19" fill="#d3f5d0" stroke={INK} strokeWidth={2.6} />
          <path d="M19 15l14 9-14 9z" fill={INK} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        </g>
      );
      break;
    case "target":
      body = (
        <g>
          <circle cx="22" cy="26" r="17" fill="#ffffff" stroke={INK} strokeWidth={2.6} />
          <circle cx="22" cy="26" r="10" fill="#ffd1dc" stroke={INK} strokeWidth={2.4} />
          <circle cx="22" cy="26" r="3.5" fill={INK} />
          <path d="M22 26L42 6M36 5h7v7" {...s} strokeWidth={3} />
        </g>
      );
      break;
    case "search":
      body = (
        <g>
          <circle cx="20" cy="20" r="12.5" fill="#dbeafe" stroke={INK} strokeWidth={2.8} />
          <path d="M29.5 29.5l12 12" {...s} strokeWidth={5.5} stroke="#8a5a2b" />
        </g>
      );
      break;
    case "warning":
      body = (
        <g>
          <path d="M24 5L44 41H4z" fill="#ffd43b" stroke={INK} strokeWidth={2.8} strokeLinejoin="round" />
          <path d="M24 17v12" {...s} strokeWidth={3.6} />
          <circle cx="24" cy="35" r="2.3" fill={INK} />
        </g>
      );
      break;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      {body}
    </svg>
  );
}
