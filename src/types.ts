export type Spx3Signal = {
  id: string;
  time: number;
  price: number;
  shape: string;
  side: "long" | "short" | string;
  variant: string;
  color: string;
  source: string;
};

export type ColorRole = "bullish" | "bearish" | "neutral" | string;

export type FlowPoint = {
  time: number;
  value: number;
};

export type RetailFlowPoint = FlowPoint & {
  colorRole: ColorRole;
};

export type Spx3ViewResponse = {
  meta?: unknown;
  priceSeries?: unknown;
  currentPrice?: unknown;
  retailFlowSeries?: RetailFlowPoint[];
  instFlowSeries?: FlowPoint[];
  levels?: unknown;
  areas?: unknown;
  profileBars?: unknown;
  signals: Spx3Signal[];
  sessionLines?: unknown;
  opexFlowSeries?: unknown;
  opexProfileBars?: unknown;
  opexExpirationDate?: unknown;
  opexBadgeLabel?: unknown;
};

export type KnownState = {
  signalIds: string[];
  updatedAt: string;
};
