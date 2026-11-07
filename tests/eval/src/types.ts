export interface Turn {
  speaker: string;
  text: string;
}

export interface Session {
  date?: string | undefined;
  turns: Turn[];
}

export interface Conversation {
  id: string;
  sessions: Session[];
}

export interface Question {
  id: string;
  conversationId: string;
  question: string;
  answer: string;
  category: string;
}

export interface Dataset {
  name: string;
  conversations: Conversation[];
  questions: Question[];
}

export interface QuestionResult {
  questionId: string;
  conversationId: string;
  category: string;
  question: string;
  gold: string;
  prediction: string;
  exactMatch: boolean;
  f1: number;
  injectedTokens: number;
  providerInputTokens: number | null;
  latencyMs: number;
  costUsd: number;
}

export interface Aggregates {
  questions: number;
  answered: number;
  accuracy: number;
  meanF1: number;
  meanInjectedTokens: number;
  accuracyPer1kTokens: number;
  p50LatencyMs: number;
  totalCostUsd: number;
}

export interface CompileCounts {
  sourcesCompleted: number;
  sourcesFailed: number;
  pages: number;
  pageVersions: number;
  routingReviews: number;
}

export interface ConversationSummary {
  conversationId: string;
  brainId: string;
  counts: CompileCounts;
}

export interface RoutingBucket {
  bucket: string;
  count: number;
}

export interface RoutingReviewExample {
  claim: string;
  best: number;
  second: number;
  gap: number;
  candidateCount: number;
}

export interface RoutingAggregate {
  total: number;
  actions: { place: number; review: number; new: number };
  bestBuckets: RoutingBucket[];
  gapBuckets: RoutingBucket[];
  best: { mean: number; median: number };
  meanCandidateCount: number;
  topReviews: RoutingReviewExample[];
}

export interface EvalResults {
  mode: "fake" | "live";
  label: "plumbing check, not accuracy" | "measured";
  dataset: string;
  datasetPath: string;
  startedAt: string;
  finishedAt: string;
  budgetUsd: number | null;
  spentUsd: number;
  stoppedReason: string | null;
  aggregates: Aggregates;
  routing: RoutingAggregate;
  conversations: ConversationSummary[];
  results: QuestionResult[];
  errors: string[];
}
