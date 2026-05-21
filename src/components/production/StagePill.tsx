import type { JobStage } from '../../types/production';

interface Props { stage: JobStage; }

const LABELS: Record<JobStage, string> = {
  job_created: 'Job Created',
  hoa_811: 'HOA / 811',
  materials_ordered: 'Materials Ordered',
  scheduled: 'Scheduled',
  in_install: 'In Install',
  job_complete: 'Job Complete',
  final_payment: 'Final Payment',
};

export function StagePill({ stage }: Props) {
  return (
    <span className="inline-block rounded-md bg-[#0a1f3d] text-white px-2 py-0.5 text-xs font-medium">
      {LABELS[stage]}
    </span>
  );
}
