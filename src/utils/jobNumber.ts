// src/utils/jobNumber.ts
// DB trigger generates the job_number string. This is display-only formatting.

export function formatJobNumberShort(jobNumber: string): string {
  // 'AF-2026-0007' → '#0007'
  const parts = jobNumber.split('-');
  return parts.length === 3 ? `#${parts[2]}` : jobNumber;
}

export function formatJobNumberFull(jobNumber: string): string {
  // Pass-through; placeholder for future formatting if needed.
  return jobNumber;
}
