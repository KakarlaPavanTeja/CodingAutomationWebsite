/**
 * Paints a Scene (see board.ts) as Satori-compatible JSX. Every element is
 * absolutely positioned at the coordinates the layout computed; groups (sticky
 * notes, cards, tape) are rotated as a whole. No measuring happens here.
 */
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { CODE_INDENT_EM_PER_SPACE } from "./measure";
import { INK, type Item, type Scene } from "./board";
import { Icon } from "./icons";

export const FONT_FAMILY = "Kalam";

const PAPER = "#f6f3ec";
const DOTS = "radial-gradient(circle, #d9d2c3 1.6px, transparent 1.7px)";

const abs = (left: number, top: number, extra: CSSProperties = {}): CSSProperties => ({
  position: "absolute",
  left,
  top,
  display: "flex",
  ...extra,
});

/** Paint items into a container of size w×h. Paths go in one SVG overlay on top. */
function paint(items: Item[], w: number, h: number, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const paths: ReactElement[] = [];
  items.forEach((item, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (item.t) {
      case "box":
        out.push(
          <div
            key={key}
            style={abs(item.x, item.y, {
              width: item.w,
              height: item.h,
              backgroundColor: item.fill,
              borderRadius: item.radius ?? 0,
              ...(item.shadow ? { boxShadow: item.shadow } : {}),
            })}
          />,
        );
        break;
      case "icon":
        out.push(
          <div key={key} style={abs(item.x, item.y, { width: item.size, height: item.size })}>
            <Icon name={item.name} size={item.size} />
          </div>,
        );
        break;
      case "path":
        paths.push(
          <path
            key={key}
            d={item.d}
            fill="none"
            stroke={item.color}
            strokeWidth={item.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={item.opacity ?? 1}
          />,
        );
        break;
      case "text":
        item.lines.forEach((line, li) => {
          const centred = item.align === "center" && item.w !== undefined;
          out.push(
            <div
              key={`${key}-${li}`}
              style={abs(
                centred ? item.x : item.x + line.indent * CODE_INDENT_EM_PER_SPACE * item.size,
                item.y + li * item.lh,
                {
                  height: item.lh,
                  fontSize: item.size,
                  lineHeight: `${item.lh}px`,
                  fontWeight: item.weight === "bold" ? 700 : 400,
                  color: item.color ?? INK,
                  whiteSpace: "pre",
                  ...(centred ? { width: item.w, justifyContent: "center" } : {}),
                },
              )}
            >
              {line.text}
            </div>,
          );
        });
        break;
      case "group":
        out.push(
          <div
            key={key}
            style={abs(item.x, item.y, {
              width: item.w,
              height: item.h,
              ...(item.rotate ? { transform: `rotate(${item.rotate}deg)` } : {}),
            })}
          >
            {paint(item.items, item.w, item.h, key)}
          </div>,
        );
        break;
    }
  });
  if (paths.length) {
    out.push(
      <svg
        key={`${keyPrefix}-paths`}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
      >
        {paths}
      </svg>,
    );
  }
  return out;
}

export function StickyBoard({ scene }: { scene: Scene }): ReactElement {
  return (
    <div
      style={{
        width: scene.width,
        height: scene.height,
        position: "relative",
        display: "flex",
        backgroundColor: PAPER,
        backgroundImage: DOTS,
        backgroundSize: "28px 28px",
        fontFamily: FONT_FAMILY,
        color: INK,
      }}
    >
      {paint(scene.items, scene.width, scene.height, "s")}
    </div>
  );
}
