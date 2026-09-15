import type { CSSProperties, PointerEvent, ReactNode } from "react";
import type { Slide, SlideObject, TextNode } from "../editor-core/model";
export function RichText({ node }: { node: TextNode }): ReactNode {
  if (node.text !== undefined) {
    const style: CSSProperties = {};
    for (const m of node.marks ?? []) {
      if (m.type === "bold") style.fontWeight = 700;
      if (m.type === "italic") style.fontStyle = "italic";
      if (m.type === "underline") style.textDecoration = "underline";
      if (m.type === "textStyle") {
        if (typeof m.attrs?.color === "string") style.color = m.attrs.color;
        if (typeof m.attrs?.fontFamily === "string")
          style.fontFamily = m.attrs.fontFamily;
      }
    }
    return <span style={style}>{node.text}</span>;
  }
  if (node.type === "hardBreak") return <br />;
  if (node.type === "doc")
    return (
      <>
        {node.content?.map((n, i) => (
          <RichText node={n} key={i} />
        ))}
      </>
    );
  return (
    <div>
      {node.content?.map((n, i) => (
        <RichText node={n} key={i} />
      ))}
    </div>
  );
}
export function DrawObject({ object: o }: { object: SlideObject }) {
  if (o.kind === "image")
    return (
      <image
        href={o.src}
        width={o.width}
        height={o.height}
        preserveAspectRatio="xMidYMid meet"
      />
    );
  if (o.kind === "ellipse")
    return (
      <ellipse
        cx={o.width / 2}
        cy={o.height / 2}
        rx={o.width / 2}
        ry={o.height / 2}
        fill={o.fill}
        stroke={o.stroke}
        strokeWidth={o.strokeWidth}
      />
    );
  if (o.kind === "line")
    return (
      <line
        x1="0"
        y1="0"
        x2={o.width}
        y2={o.height}
        stroke={o.stroke === "transparent" ? o.color : o.stroke}
        strokeWidth={Math.max(2, o.strokeWidth)}
      />
    );
  if (o.kind === "arrow")
    return (
      <polygon
        points={`0,${o.height * 0.3} ${o.width * 0.65},${o.height * 0.3} ${o.width * 0.65},0 ${o.width},${o.height / 2} ${o.width * 0.65},${o.height} ${o.width * 0.65},${o.height * 0.7} 0,${o.height * 0.7}`}
        fill={o.fill}
        stroke={o.stroke}
        strokeWidth={o.strokeWidth}
      />
    );
  return (
    <>
      <rect
        width={o.width}
        height={o.height}
        fill={o.fill}
        stroke={o.stroke}
        strokeWidth={o.strokeWidth}
        rx={o.kind === "rectangle" ? 3 : 0}
      />
      <foreignObject
        width={o.width}
        height={o.height}
        style={{ overflow: "visible", pointerEvents: "none" }}
      >
        <div
          style={{
            fontSize: o.fontSize,
            fontFamily: o.fontFamily,
            fontWeight: o.bold ? 700 : 400,
            fontStyle: o.italic ? "italic" : "normal",
            color: o.color,
            textAlign: o.align as CSSProperties["textAlign"],
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            lineHeight: 1.25,
          }}
        >
          {o.richText ? <RichText node={o.richText} /> : o.text}
        </div>
      </foreignObject>
    </>
  );
}
export function SlideCanvas({
  slide,
  width,
  height,
  selected = [],
  onPointerDown,
  onDoubleClick,
  preview,
  grid = false,
  guideX,
  guideY,
}: {
  slide: Slide;
  width: number;
  height: number;
  selected?: string[];
  onPointerDown?: (
    e: PointerEvent<SVGGElement>,
    o: SlideObject,
    resize: boolean,
  ) => void;
  onDoubleClick?: (o: SlideObject) => void;
  preview?: { ids: string[]; dx: number; dy: number; dw: number; dh: number };
  grid?: boolean;
  guideX?: number;
  guideY?: number;
}) {
  return (
    <svg
      className="slide-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={slide.name}
      style={{ background: slide.background }}
    >
      <defs>
        <pattern
          id={`grid-${slide.id}`}
          width="32"
          height="32"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r="1" fill="#a8b7ad" />
        </pattern>
      </defs>
      {grid && (
        <rect
          width={width}
          height={height}
          fill={`url(#grid-${slide.id})`}
          opacity=".65"
        />
      )}
      {slide.objects.map((original) => {
        const o = preview?.ids.includes(original.id)
          ? {
              ...original,
              x: original.x + preview.dx,
              y: original.y + preview.dy,
              width: Math.max(20, original.width + preview.dw),
              height: Math.max(20, original.height + preview.dh),
            }
          : original;
        const active = selected.includes(o.id);
        return (
          <g
            key={o.id}
            data-object-id={o.id}
            transform={`translate(${o.x} ${o.y}) rotate(${o.rotation} ${o.width / 2} ${o.height / 2})`}
            onPointerDown={(e) => onPointerDown?.(e, original, false)}
            onDoubleClick={() => onDoubleClick?.(original)}
            style={{ cursor: onPointerDown ? "move" : "default" }}
          >
            <DrawObject object={o} />
            <rect
              className="object-hit-area"
              width={o.width}
              height={o.height}
              fill="transparent"
            />
            {active && (
              <>
                <rect
                  width={o.width}
                  height={o.height}
                  fill="none"
                  stroke="#557ce0"
                  strokeWidth="2"
                />
                <rect
                  x={o.width - 6}
                  y={o.height - 6}
                  width="12"
                  height="12"
                  fill="white"
                  stroke="#557ce0"
                  strokeWidth="2"
                  style={{ cursor: "nwse-resize" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onPointerDown?.(e, original, true);
                  }}
                />
              </>
            )}
          </g>
        );
      })}
      {guideX !== undefined && (
        <line
          x1={guideX}
          x2={guideX}
          y1="0"
          y2={height}
          stroke="#df749e"
          strokeDasharray="6 4"
        />
      )}
      {guideY !== undefined && (
        <line
          y1={guideY}
          y2={guideY}
          x1="0"
          x2={width}
          stroke="#df749e"
          strokeDasharray="6 4"
        />
      )}
    </svg>
  );
}
