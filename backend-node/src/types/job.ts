export type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface JobHistoryEntry {
  status: JobStatus;
  timestamp: Date;
  message?: string;
}

export interface ArtifactItem {
  label: string;
  kind: 'overlay' | 'vector' | 'report' | 'log';
  url: string;
}

export interface TakeoffSummary {
  features: number;
  materials: number;
  targets: Record<string, number>;
}

