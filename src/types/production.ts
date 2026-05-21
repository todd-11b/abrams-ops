// src/types/production.ts

export type JobStage =
  | 'job_created'
  | 'hoa_811'
  | 'materials_ordered'
  | 'scheduled'
  | 'in_install'
  | 'job_complete'
  | 'final_payment';

export type JobStatus = 'active' | 'blocked' | 'needs_office_review' | 'complete';

export type ScheduledStartWindow = 'morning' | 'afternoon' | 'all_day';

export type DepositStatus = 'unpaid' | 'paid' | 'pending_invoice';

export type ChecklistSectionKey = 'loadout' | 'onsite' | 'install' | 'clean' | 'walkthrough';

export type PhotoPhase = 'loadout' | 'onsite' | 'install' | 'clean' | 'issue';

export type IssueType =
  | 'sprinkler_hit'
  | 'material_shortage'
  | 'weather_delay'
  | 'customer_concern'
  | 'gate_issue'
  | 'grade_issue'
  | 'utility_conflict'
  | 'other';

export type IssueSeverity = 'low' | 'medium' | 'high';

export type ActivitySource = 'manual' | 'workflow' | 'system';

export type Actor = 'todd' | 'ty';

export interface Job {
  job_id: string;
  job_number: string;
  contact_id: string;
  proposal_id: string | null;
  stage: JobStage;
  status: JobStatus;
  install_date: string | null;
  scheduled_start_window: ScheduledStartWindow | null;
  deposit_status: DepositStatus;
  deposit_paid_at: string | null;
  signed_at: string | null;
  blocked_reason: string | null;
  blocked_note: string | null;
  blocked_at: string | null;
  needs_review_reason: string | null;
  access_notes: Record<string, unknown>;
  last_activity_at: string;
  last_activity_by: string | null;
  completed_at: string | null;
  archived_at: string | null;
  last_ghl_sync: string | null;
  ghl_stage: string | null;
  last_blocked_notification_at: string | null;
  created_at: string;
}

export interface JobFenceSpec {
  spec_id: string;
  job_id: string;
  fence_lines: Array<Record<string, unknown>>;
  gates: Array<Record<string, unknown>>;
  addons: Array<Record<string, unknown>>;
  total_sections: number;
  total_lf: number;
  proposal_total: number;
}

export interface ChecklistItem {
  checklist_id: string;
  job_id: string;
  section: ChecklistSectionKey;
  item_id: string;
  label: string;
  checked: boolean;
  checked_at: string | null;
  skippable: boolean;
  skipped: boolean;
  skip_reason: string | null;
  photo_required: boolean;
  photo_uploaded: boolean;
}

export interface JobPhoto {
  photo_id: string;
  job_id: string;
  phase: PhotoPhase;
  url: string;
  uploaded_at: string;
  uploaded_by: string | null;
  synced: boolean;
}

export interface JobIssue {
  issue_id: string;
  job_id: string;
  contact_id: string | null;
  type: IssueType;
  severity: IssueSeverity;
  customer_visible: boolean;
  note: string | null;
  photos: string[];
  section: ChecklistSectionKey | null;
  created_by: string | null;
  created_at: string;
  resolved: boolean;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface ActivityLogEntry {
  activity_id: string;
  job_id: string | null;
  contact_id: string | null;
  type: string;
  actor: string | null;
  source: ActivitySource;
  payload: Record<string, unknown>;
  created_at: string;
}
