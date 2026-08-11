/** Column widths for the "Recent runs" table — a checkbox, version, ran-at
   date, recall, precision, citation, pass, cost. */
export const TABLE_GRID_COLS = "28px 0.6fr 1fr 0.7fr 0.7fr 0.7fr 0.7fr 0.8fr";

/** Trend chart y-axis bounds — metrics are fractions in [0,1]; a [0.6, 1.0]
   window (LineChart's own default) keeps real movement readable instead of
   flattening it against a full 0–1 range. */
export const CHART_Y_MIN = 0.6;
export const CHART_Y_MAX = 1.0;

/** A run is selectable for Compare only once exactly this many are checked. */
export const COMPARE_SELECTION_SIZE = 2;
