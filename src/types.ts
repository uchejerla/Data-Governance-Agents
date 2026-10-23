// Shared domain model for the steward workspace.
// The catalogue, glossary, quality rules, policies and access records below are
// the inputs every assistant reasons over. The app ships with a seeded snapshot;
// swapping `src/data/seed.ts` for a real metadata export is the integration path.

export type DomainId = 'customer' | 'claims' | 'finance';

export type Classification = 'Public' | 'Internal' | 'Confidential' | 'Restricted';

export type TrustLevel = 'Certified' | 'Endorsed' | 'Draft' | 'Deprecated';

export type AssetType = 'Table' | 'View' | 'Model feature set' | 'Report' | 'Dashboard' | 'API';

export type PiiKind =
  | 'Direct identifier'
  | 'Quasi identifier'
  | 'Contact'
  | 'Financial'
  | 'Health'
  | 'Sensitive free text';

export type QualityDimension =
  | 'Completeness'
  | 'Validity'
  | 'Uniqueness'
  | 'Timeliness'
  | 'Consistency'
  | 'Accuracy';

export type RuleStatus = 'Failing' | 'Warning' | 'Passing';

export type Trend = 'worsening' | 'stable' | 'improving';

export type TermStatus = 'Approved' | 'Draft' | 'Proposed';

export type Criticality = 'Tier 1' | 'Tier 2' | 'Tier 3';

export type AccessLevel = 'Read' | 'Read + export' | 'Write';

export type PersonRole =
  | 'Data Steward'
  | 'Data Owner'
  | 'Analyst'
  | 'Data Engineer'
  | 'Marketing Manager'
  | 'Data Scientist'
  | 'Compliance Officer'
  | 'Fraud Investigator'
  | 'Contractor';

export interface Domain {
  id: DomainId;
  name: string;
  executive: string;
  description: string;
}

export interface Person {
  id: string;
  name: string;
  role: PersonRole;
  domainId: DomainId | 'platform' | 'risk';
  clearance: Classification;
  trainingCurrent: boolean;
  email: string;
}

export interface AssetColumn {
  name: string;
  type: string;
  pii?: PiiKind;
  description?: string;
  nullable?: boolean;
}

export interface Asset {
  id: string;
  name: string;
  physicalName: string;
  type: AssetType;
  domainId: DomainId;
  description?: string;
  ownerId?: string;
  stewardId?: string;
  trustLevel: TrustLevel;
  classification?: Classification;
  refresh: string;
  rowCount: number;
  lastProfiled?: string;
  lastReviewed?: string;
  criticality: Criticality;
  downstreamCount: number;
  sourceSystem: string;
  tags: string[];
  glossaryTermIds: string[];
  columns: AssetColumn[];
}

export interface GlossaryTerm {
  id: string;
  term: string;
  definition?: string;
  domainId: DomainId;
  ownerId?: string;
  status: TermStatus;
  synonyms: string[];
  linkedAssetIds: string[];
  lastUpdated?: string;
}

export interface QualityRule {
  id: string;
  assetId: string;
  name: string;
  dimension: QualityDimension;
  expression: string;
  threshold: string;
  observed: string;
  failedRows: number;
  status: RuleStatus;
  trend: Trend;
  lastRun: string;
}

export interface PolicyClause {
  id: string;
  docCode: string;
  docTitle: string;
  version: string;
  policyOwner: string;
  section: string;
  heading: string;
  text: string;
  topics: string[];
  shortAnswer: string;
  control: string;
  escalateTo?: string;
}

export interface AccessGrant {
  id: string;
  personId: string;
  assetId: string;
  level: AccessLevel;
  purpose: string;
  approvedOn: string;
  expiresOn?: string;
}

export interface PendingAccessRequest {
  id: string;
  requesterId: string;
  assetId: string;
  requestedLevel: AccessLevel;
  purpose: string;
  requestedOn: string;
  businessJustification: string;
}

export interface Attestation {
  personId: string;
  policyCode: string;
  dueOn: string;
  status: 'Outstanding' | 'Complete';
}

export interface GovernanceSnapshot {
  asOf: string;
  domains: Domain[];
  people: Person[];
  assets: Asset[];
  terms: GlossaryTerm[];
  rules: QualityRule[];
  policies: PolicyClause[];
  accessGrants: AccessGrant[];
  pendingAccessRequests: PendingAccessRequest[];
  attestations: Attestation[];
}

// ---------- Steward decisions ----------

// A decision is the steward's recorded response to one recommendation. Keys are
// the canonical recommendation ids (see `recKey` in src/lib/decisions.ts), which
// are stable across reloads because they come from the seeded record ids.

export type DecisionStatus = 'accepted' | 'dismissed';

export interface Decision {
  status: DecisionStatus;
  at: string;
  assigneeId?: string;
  /** Display name of the steward who recorded this decision. */
  by?: string;
  /** Stable id of that steward, as issued by the identity provider. */
  byId?: string;
}

export type DecisionMap = Record<string, Decision>;

// ---------- Assistant result shapes ----------

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

export interface Finding {
  label: string;
  detail: string;
  severity: Severity;
  clauseId?: string;
}

export interface CopyBlock {
  title: string;
  body: string;
}

export interface AssistantResult<T> {
  headline: string;
  summary: string;
  data: T;
}
