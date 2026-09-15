import type { Chart } from "../editor-core/model";
const colours = [
  "#386b5a",
  "#b4d19c",
  "#80a6b1",
  "#d1a178",
  "#b4a2bd",
  "#9ea987",
];
export interface ChartDatum {
  label: string;
  value: number;
  x?: number;
}
export function ChartView({
  chart,
  data,
}: {
  chart: Chart;
  data: ChartDatum[];
}) {
  const limited = data
    .filter(
      (d) =>
        Number.isFinite(d.value) &&
        (chart.kind !== "scatter" || Number.isFinite(d.x)),
    )
    .slice(0, 150);
  const min = Math.min(0, ...limited.map((d) => d.value));
  const max = Math.max(1, ...limited.map((d) => d.value));
  const xMin = Math.min(0, ...limited.map((d) => d.x ?? 0));
  const xMax = Math.max(1, ...limited.map((d) => d.x ?? 0));
  const w = 500;
  const h = 220;
  const y = (value: number) => h - ((value - min) / (max - min)) * h;
  const x = (d: ChartDatum, i: number) =>
    chart.kind === "scatter"
      ? (((d.x ?? 0) - xMin) / (xMax - xMin)) * w
      : (i * w) / Math.max(1, limited.length - 1);
  const total = limited.reduce((sum, d) => sum + Math.max(0, d.value), 0) || 1;
  let angle = -Math.PI / 2;
  return (
    <svg
      viewBox="0 0 560 310"
      role="img"
      aria-label={chart.title}
      className="chart-svg"
    >
      <text x="28" y="26" fontSize="17" fontWeight="600" fill="currentColor">
        {chart.title}
      </text>
      {chart.kind === "pie" ? (
        <g transform="translate(175 168)">
          {limited.map((d, i) => {
            const sweep = (Math.max(0, d.value) / total) * Math.PI * 2;
            const start = angle;
            angle += sweep;
            const end = angle;
            const x1 = Math.cos(start) * 94;
            const y1 = Math.sin(start) * 94;
            const x2 = Math.cos(end) * 94;
            const y2 = Math.sin(end) * 94;
            return (
              <path
                key={i}
                d={
                  sweep >= Math.PI * 2 - 0.001
                    ? "M0,-94 A94,94 0 1,1 -.01,-94 L0,0Z"
                    : `M0,0 L${x1},${y1} A94,94 0 ${sweep > Math.PI ? 1 : 0},1 ${x2},${y2} Z`
                }
                fill={colours[i % colours.length]}
              >
                <title>{`${d.label}: ${d.value}`}</title>
              </path>
            );
          })}
          <circle r="53" fill="var(--surface)" />
        </g>
      ) : (
        <g transform="translate(35 50)">
          {[0, 0.25, 0.5, 0.75, 1].map((p) => (
            <g key={p}>
              <line
                x1="0"
                x2={w}
                y1={h * p}
                y2={h * p}
                stroke="var(--border)"
              />
              <text
                x="-8"
                y={h * p + 3}
                textAnchor="end"
                fontSize="9"
                fill="var(--muted)"
              >
                {Number((max - (max - min) * p).toPrecision(3))}
              </text>
            </g>
          ))}
          {chart.kind === "bar" ? (
            limited.map((d, i) => (
              <rect
                key={i}
                x={(i * w) / limited.length + 7}
                y={Math.min(y(0), y(d.value))}
                width={Math.max(2, w / limited.length - 14)}
                height={Math.max(1, Math.abs(y(d.value) - y(0)))}
                fill={colours[i % colours.length]}
                rx="3"
              >
                <title>{`${d.label}: ${d.value}`}</title>
              </rect>
            ))
          ) : (
            <>
              {chart.kind === "line" && (
                <polyline
                  fill="none"
                  stroke="#386b5a"
                  strokeWidth="3"
                  points={limited
                    .map((d, i) => `${x(d, i)},${y(d.value)}`)
                    .join(" ")}
                />
              )}
              {limited.map((d, i) => (
                <circle
                  key={i}
                  cx={x(d, i)}
                  cy={y(d.value)}
                  r="4"
                  fill="#386b5a"
                >
                  <title>{`${d.label}: ${d.value}`}</title>
                </circle>
              ))}
            </>
          )}
          {limited.length <= 12 &&
            chart.kind !== "scatter" &&
            limited.map((d, i) => (
              <text
                key={i}
                x={
                  ((i + (chart.kind === "bar" ? 0.5 : 0)) * w) /
                  (chart.kind === "bar"
                    ? limited.length
                    : Math.max(1, limited.length - 1))
                }
                y={h + 18}
                textAnchor="middle"
                fontSize="10"
                fill="var(--muted)"
              >
                {d.label.slice(0, 10)}
              </text>
            ))}
          {chart.kind === "scatter" &&
            [0, 0.25, 0.5, 0.75, 1].map((p) => (
              <text
                key={p}
                x={p * w}
                y={h + 18}
                textAnchor="middle"
                fontSize="10"
                fill="var(--muted)"
              >
                {Number((xMin + p * (xMax - xMin)).toPrecision(3))}
              </text>
            ))}
        </g>
      )}
      {chart.kind === "pie" &&
        limited.slice(0, 8).map((d, i) => (
          <g key={i} transform={`translate(310 ${65 + i * 25})`}>
            <rect
              width="10"
              height="10"
              rx="2"
              fill={colours[i % colours.length]}
            />
            <text x="18" y="9" fontSize="12" fill="currentColor">
              {d.label.slice(0, 20)}
            </text>
          </g>
        ))}
    </svg>
  );
}
