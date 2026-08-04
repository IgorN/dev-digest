import React from "react";

export function CircularScore({
  score,
  size = 44,
  stroke = 4,
}: {
  score: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const c = score >= 75 ? "var(--ok)" : score >= 50 ? "var(--warn)" : "var(--crit)";
  // A score of 0 is a REAL verdict ("critical problems", per the Review
  // contract), but drawing it literally offsets the arc by the full
  // circumference — nothing renders, and an emphatic 0 reads as "didn't run".
  // Floor the drawn arc at a short visible stub so a red 0 looks judged, not
  // empty. Only affects the drawing; the number shown is untouched.
  const MIN_ARC = 0.05;
  const arc = Math.min(Math.max(score / 100, MIN_ARC), 1);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-hover)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={c}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - arc)}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset .6s ease" }}
        />
      </svg>
      <div
        className="tnum"
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          fontSize: size * 0.3,
          fontWeight: 700,
        }}
      >
        {score}
      </div>
    </div>
  );
}
