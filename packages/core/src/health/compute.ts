export interface HealthMetrics {
  now: string;
  pageCount: number;
  searchablePages: number;
  contestedPages: number;
  deprecatedPages: number;
  failedSources: number;
  backlogSources: number;
  recentCaptures: number;
  recentPageChanges: number;
  unackedChanges: number;
  unackedConnections: number;
  profileFields: number;
  lastCaptureAt: string | null;
  lastPageChangeAt: string | null;
}

export type FactorTone = "positive" | "neutral" | "negative";

export interface HealthFactor {
  key: string;
  label: string;
  description: string;
  value: number;
  unit: string;
  tone: FactorTone;
}

export interface HealthScore {
  freshness: number;
  readiness: number;
  strain: number;
  factors: {
    freshness: HealthFactor[];
    readiness: HealthFactor[];
    strain: HealthFactor[];
  };
}

export const HEALTH_WEIGHTS = Object.freeze({
  freshnessDecayDays: 30,
  recentCaptureTarget: 3,
  recentCaptureBonus: 10,
  recentChangeTarget: 5,
  recentChangeBonus: 10,
  readinessPageTarget: 20,
  readinessPages: 40,
  readinessSearchableTarget: 20,
  readinessSearchable: 30,
  readinessProfile: 30,
  readinessFailedSourceCap: 20,
  readinessFailedSourcePenalty: 5,
  readinessContestedCap: 20,
  readinessContestedPenalty: 5,
  strainFailedSourceCap: 60,
  strainFailedSourcePenalty: 15,
  strainBacklogCap: 30,
  strainBacklogPenalty: 10,
  strainContestedCap: 15,
  strainContestedPenalty: 5,
  strainDeprecatedCap: 15,
  strainDeprecatedPenalty: 5,
  strainUnackedChangeCap: 10,
  strainUnackedChangePenalty: 2,
  strainUnackedConnectionCap: 10,
  strainUnackedConnectionPenalty: 2,
  profileFieldTotal: 7,
});

const DAY_MS = 86_400_000;
const W = HEALTH_WEIGHTS;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function proportion(value: number, target: number): number {
  if (target <= 0) return 1;
  return Math.min(1, Math.max(0, value) / target);
}

function cappedPenalty(value: number, perUnit: number, cap: number): number {
  return Math.min(cap, Math.max(0, value) * perUnit);
}

function raisingTone(value: number): FactorTone {
  return value > 0 ? "positive" : "neutral";
}

function loweringTone(value: number): FactorTone {
  return value > 0 ? "negative" : "neutral";
}

function lastInputAt(metrics: HealthMetrics): string | null {
  const capture = metrics.lastCaptureAt === null ? Number.NaN : Date.parse(metrics.lastCaptureAt);
  const change =
    metrics.lastPageChangeAt === null ? Number.NaN : Date.parse(metrics.lastPageChangeAt);
  if (!Number.isFinite(capture) && !Number.isFinite(change)) return null;
  const present = [capture, change].filter((value) => Number.isFinite(value));
  return new Date(Math.max(...present)).toISOString();
}

export function computeHealth(metrics: HealthMetrics): HealthScore {
  const lastInput = lastInputAt(metrics);
  const daysSinceInput =
    lastInput === null
      ? W.freshnessDecayDays
      : Math.max(0, (Date.parse(metrics.now) - Date.parse(lastInput)) / DAY_MS);

  const recency = 100 * (1 - proportion(daysSinceInput, W.freshnessDecayDays));
  const captureBonus =
    W.recentCaptureBonus * proportion(metrics.recentCaptures, W.recentCaptureTarget);
  const changeBonus =
    W.recentChangeBonus * proportion(metrics.recentPageChanges, W.recentChangeTarget);
  const freshness = round1(clampPercent(recency + captureBonus + changeBonus));

  const pageScore = W.readinessPages * proportion(metrics.pageCount, W.readinessPageTarget);
  const searchableScore =
    W.readinessSearchable * proportion(metrics.searchablePages, W.readinessSearchableTarget);
  const profileScore = W.readinessProfile * proportion(metrics.profileFields, W.profileFieldTotal);
  const readinessPenalty =
    cappedPenalty(
      metrics.failedSources,
      W.readinessFailedSourcePenalty,
      W.readinessFailedSourceCap,
    ) + cappedPenalty(metrics.contestedPages, W.readinessContestedPenalty, W.readinessContestedCap);
  const readiness = round1(
    clampPercent(pageScore + searchableScore + profileScore - readinessPenalty),
  );

  const strain =
    cappedPenalty(metrics.failedSources, W.strainFailedSourcePenalty, W.strainFailedSourceCap) +
    cappedPenalty(metrics.backlogSources, W.strainBacklogPenalty, W.strainBacklogCap) +
    cappedPenalty(metrics.contestedPages, W.strainContestedPenalty, W.strainContestedCap) +
    cappedPenalty(metrics.deprecatedPages, W.strainDeprecatedPenalty, W.strainDeprecatedCap) +
    cappedPenalty(metrics.unackedChanges, W.strainUnackedChangePenalty, W.strainUnackedChangeCap) +
    cappedPenalty(
      metrics.unackedConnections,
      W.strainUnackedConnectionPenalty,
      W.strainUnackedConnectionCap,
    );

  const factors: HealthScore["factors"] = {
    freshness: [
      {
        key: "recent_captures",
        label: "Recent captures",
        description: "Completed captures from the last seven days keep the brain current.",
        value: metrics.recentCaptures,
        unit: "count",
        tone: raisingTone(metrics.recentCaptures),
      },
      {
        key: "recent_page_changes",
        label: "Recent page changes",
        description: "Page changes from the last seven days keep the brain current.",
        value: metrics.recentPageChanges,
        unit: "count",
        tone: raisingTone(metrics.recentPageChanges),
      },
      {
        key: "days_since_input",
        label: "Days since input",
        description: "Freshness decays as time passes without a capture or a page change.",
        value: round1(daysSinceInput),
        unit: "days",
        tone: daysSinceInput > 0 ? "negative" : "neutral",
      },
    ],
    readiness: [
      {
        key: "pages",
        label: "Pages",
        description: "More pages give the brain more to answer from.",
        value: metrics.pageCount,
        unit: "pages",
        tone: raisingTone(metrics.pageCount),
      },
      {
        key: "searchable_pages",
        label: "Searchable pages",
        description: "Active pages with an embedding can be found by search.",
        value: metrics.searchablePages,
        unit: "pages",
        tone: raisingTone(metrics.searchablePages),
      },
      {
        key: "profile_completeness",
        label: "Profile completeness",
        description: "A filled profile tells the brain who it serves.",
        value: metrics.profileFields,
        unit: "fields",
        tone: raisingTone(metrics.profileFields),
      },
      {
        key: "failed_sources",
        label: "Failed sources",
        description: "Sources that failed to compile leave knowledge missing.",
        value: metrics.failedSources,
        unit: "count",
        tone: loweringTone(metrics.failedSources),
      },
      {
        key: "contested_pages",
        label: "Contested pages",
        description: "Unresolved contested pages need a human decision.",
        value: metrics.contestedPages,
        unit: "pages",
        tone: loweringTone(metrics.contestedPages),
      },
    ],
    strain: [
      {
        key: "failed_sources",
        label: "Failed sources",
        description: "Every failed source is work that must be retried or discarded.",
        value: metrics.failedSources,
        unit: "count",
        tone: loweringTone(metrics.failedSources),
      },
      {
        key: "compile_backlog",
        label: "Compile backlog",
        description: "Pending and compiling sources are queued work.",
        value: metrics.backlogSources,
        unit: "count",
        tone: loweringTone(metrics.backlogSources),
      },
      {
        key: "contested_pages",
        label: "Contested pages",
        description: "Contested pages await resolution.",
        value: metrics.contestedPages,
        unit: "pages",
        tone: loweringTone(metrics.contestedPages),
      },
      {
        key: "deprecated_pages",
        label: "Deprecated pages",
        description: "Deprecated pages await cleanup.",
        value: metrics.deprecatedPages,
        unit: "pages",
        tone: loweringTone(metrics.deprecatedPages),
      },
      {
        key: "unacked_changes",
        label: "Unacknowledged changes",
        description: "Unacknowledged change events accumulate review debt.",
        value: metrics.unackedChanges,
        unit: "count",
        tone: loweringTone(metrics.unackedChanges),
      },
      {
        key: "unacked_connections",
        label: "Unacknowledged connections",
        description: "Unacknowledged connections accumulate review debt.",
        value: metrics.unackedConnections,
        unit: "count",
        tone: loweringTone(metrics.unackedConnections),
      },
    ],
  };

  return { freshness, readiness, strain: round1(clampPercent(strain)), factors };
}
