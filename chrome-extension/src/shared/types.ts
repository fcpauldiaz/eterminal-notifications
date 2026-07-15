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

export type ProfileBar = {
  id: string;
  centerPrice: number;
  topPrice: number;
  bottomPrice: number;
  widthRatio: number;
  colorRole: string;
};

export type PricePoint = {
  time: number;
  value: number;
};

export type Spx3ViewResponse = {
  meta?: unknown;
  priceSeries?: PricePoint[];
  currentPrice?: PricePoint;
  retailFlowSeries?: RetailFlowPoint[];
  instFlowSeries?: FlowPoint[];
  levels?: unknown;
  areas?: unknown;
  profileBars?: ProfileBar[];
  signals: Spx3Signal[];
  sessionLines?: unknown;
  opexFlowSeries?: FlowPoint[];
  opexProfileBars?: ProfileBar[];
  opexExpirationDate?: string;
  opexBadgeLabel?: string;
};

export type NearCrossSnapshot = {
  nearCross: boolean;
  gap: number;
  retailValue: number;
  instValue: number;
};

export type SetupKind = "short_cross" | "long_cross";

export type ExtremeBand = 30 | 40;

export type ExtremeLevelLabel =
  | "+30"
  | "-30"
  | "+40"
  | "-40";

export type FlowExtremeHit = {
  key: string;
  series: "retail" | "inst";
  band: ExtremeBand;
  label: ExtremeLevelLabel;
  value: number;
  enteredFromInside: boolean;
  directedApproach: boolean;
  trajectoryValid: boolean;
  pathSummary: string;
};

export type DirectedSetup = {
  kind: SetupKind;
  gap: number;
  retailValue: number;
  instValue: number;
  instSlope: number;
  bias: ColorRole;
  preferredZone: boolean;
  alertKey: string;
  pathSummary: string;
  gapShrinking: boolean;
};

export type OpexAlignedLevel = {
  centerPrice: number;
  generalWidth: number;
  opexWidth: number;
  strength: number;
};

/** Circles drawn on the SPX price chart for extremes and flow×level events. */
export type ChartMarkerColor = "green" | "red";

export type ChartMarkerKind = "extreme" | "flow_rs";

export type ChartMarker = {
  id: string;
  time: number;
  price: number;
  side: "above" | "below";
  color: ChartMarkerColor;
  label: string;
  kind: ChartMarkerKind;
  /** Flow series for extreme markers. */
  series?: "retail" | "inst";
  /** R / S band label when kind is flow_rs. */
  levelLabel?: string;
  levelKind?: "R" | "S";
};

/** @deprecated Prefer ChartMarker — kept as alias for storage migrants. */
export type ExtremeChartMarker = ChartMarker;

/** Resistance / support area band (price must be inside, not merely near). */
export type ChartZone = {
  label: string;
  kind: "R" | "S";
  centerPrice: number;
  topPrice: number;
  bottomPrice: number;
};

export type FlowUiState = NearCrossSnapshot & {
  bias: ColorRole | null;
  threshold: number;
  updatedAt: string;
  authOk: boolean;
  session: "eth" | "rth" | "off";
  mixedFlow: boolean;
  mutedYellow: boolean;
  mutedCboe: boolean;
  setupKind: SetupKind | null;
  preferredZone: boolean;
  instSlope: number;
  pathSummary: string | null;
  extremes: ExtremeLevelLabel[];
  bothExtremeBearish: boolean;
  opexAlignedCount: number;
  nearOpexLevel: number | null;
  extremeMarkers: ChartMarker[];
  /** Price series time range for overlay X mapping. */
  chartTimeStart: number | null;
  chartTimeEnd: number | null;
  chartPrice: number | null;
  chartPriceMin: number | null;
  chartPriceMax: number | null;
  chartLevels: number[];
};

export type ExtensionSettings = {
  enabled: boolean;
  ntfyBaseUrl: string;
  ntfyTopic: string;
  ntfyToken: string;
  nearCrossThreshold: number;
  nearCrossCooldownMs: number;
  flowExtremeBands: ExtremeBand[];
  flowExtremeCooldownMs: number;
  preferredZoneCenter: number;
  preferredZoneWidth: number;
  slopeLookbackBars: number;
  /** Lookback bars specifically for extreme entry detection (1m points). */
  extremeLookbackBars: number;
  /** Min fraction of steps that must move in the approach direction (0–1). */
  trajectoryMinStepRatio: number;
  /** Min absolute value change over lookback to count as non-flat. */
  trajectoryMinMove: number;
  opexWidthThreshold: number;
  opexPriceProximity: number;
};

export type PollState = {
  signalIds: string[];
  lastColorRole: ColorRole | null;
  baselineDone: boolean;
  updatedAt: string;
  dayKey: string;
  sessionKey: string;
  sessionAlertedTypes: string[];
  seenBullishInDay: boolean;
  seenBearishInDay: boolean;
  nearCrossActive: boolean;
  activeExtremeKeys: string[];
  prevInstValue: number | null;
  prevRetailValue: number | null;
  extremeChartMarkers: ChartMarker[];
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  ntfyBaseUrl: "https://ntfy.sh",
  ntfyTopic: "",
  ntfyToken: "",
  nearCrossThreshold: 5,
  nearCrossCooldownMs: 5 * 60 * 1000,
  flowExtremeBands: [30, 40],
  flowExtremeCooldownMs: 5 * 60 * 1000,
  preferredZoneCenter: -10,
  preferredZoneWidth: 5,
  slopeLookbackBars: 5,
  extremeLookbackBars: 45,
  trajectoryMinStepRatio: 0.6,
  trajectoryMinMove: 0.75,
  opexWidthThreshold: 0.35,
  opexPriceProximity: 8,
};

export const DEFAULT_POLL_STATE: PollState = {
  signalIds: [],
  lastColorRole: null,
  baselineDone: false,
  updatedAt: "",
  dayKey: "",
  sessionKey: "",
  sessionAlertedTypes: [],
  seenBullishInDay: false,
  seenBearishInDay: false,
  nearCrossActive: false,
  activeExtremeKeys: [],
  prevInstValue: null,
  prevRetailValue: null,
  extremeChartMarkers: [],
};

export const TERMINAL_ORIGIN = "https://terminal.emini.today";
export const SPX3_VIEW_PATH = "/api/user/spx3-view";
export const POLL_ALARM_NAME = "spx3-poll";
export const POLL_PERIOD_MINUTES = 0.5;
export const IDLE_PERIOD_MINUTES = 1;
