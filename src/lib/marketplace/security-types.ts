export type MarketplaceAdvisorySeverity = 'low' | 'moderate' | 'high' | 'critical';
export type MarketplaceAdvisoryStatus = 'open' | 'resolved';
export type MarketplaceRevocationAction = 'warn' | 'quarantine';

export interface MarketplaceRecommendedRelease {
  moduleId: string;
  moduleSlug: string;
  version: string;
  artifactSha256: string;
  signerKeyId: string;
}

export interface MarketplaceAdvisoryAffectedRelease {
  version: string;
  artifactSha256: string;
}

export interface MarketplaceSecurityAdvisory {
  id: string;
  moduleId: string;
  moduleSlug: string;
  moduleName: string;
  severity: MarketplaceAdvisorySeverity;
  status: MarketplaceAdvisoryStatus;
  publishedAt: string;
  updatedAt: string;
  title: string;
  summary: string;
  guidance: string;
  affected: MarketplaceAdvisoryAffectedRelease[];
  affectedVersions: string[];
  fixedVersions: string[];
  references: string[];
  path: string;
  url: string;
}

export type MarketplaceRevocationTarget =
  | { type: 'artifact'; sha256: string }
  | { type: 'signing-key'; keyId: string };

export interface MarketplaceSecurityRevocation {
  id: string;
  publishedAt: string;
  updatedAt: string;
  severity: MarketplaceAdvisorySeverity;
  action: MarketplaceRevocationAction;
  target: MarketplaceRevocationTarget;
  moduleId: string;
  moduleSlug: string;
  moduleName: string;
  version: string;
  reason: string;
  summary: string;
  replacementVersion?: string;
}

export interface MarketplaceSecuritySnapshot {
  schemaVersion: 1;
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  recommendations: MarketplaceRecommendedRelease[];
  advisories: MarketplaceSecurityAdvisory[];
  revocations: MarketplaceSecurityRevocation[];
}

export interface MarketplaceMetadataSignature {
  schemaVersion: 1;
  algorithm: 'Ed25519';
  keyId: string;
  signedPath: string;
  sha256: string;
  signature: string;
}

export interface VerifiedMarketplaceSecuritySnapshot {
  snapshot: MarketplaceSecuritySnapshot;
  signature: MarketplaceMetadataSignature;
}
