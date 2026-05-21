import { describe, it, expect } from 'vitest';
import { CHECKLIST_TEMPLATE, buildChecklistRowsForJob } from './checklistTemplate';

describe('CHECKLIST_TEMPLATE', () => {
  it('has all 5 sections in order', () => {
    expect(CHECKLIST_TEMPLATE.map((s) => s.section)).toEqual([
      'loadout', 'onsite', 'install', 'clean', 'walkthrough',
    ]);
  });

  it('has 32 items total across all sections', () => {
    const total = CHECKLIST_TEMPLATE.reduce((n, s) => n + s.items.length, 0);
    expect(total).toBe(32);
  });

  it('marks Phase 5 install as skippable', () => {
    const install = CHECKLIST_TEMPLATE.find((s) => s.section === 'install')!;
    const phase5 = install.items.find((i) => i.item_id === 'install_phase_5')!;
    expect(phase5.skippable).toBe(true);
  });

  it('marks walkthrough non-gate items skippable', () => {
    const walk = CHECKLIST_TEMPLATE.find((s) => s.section === 'walkthrough')!;
    const ids = walk.items.filter((i) => i.skippable).map((i) => i.item_id);
    expect(ids).toContain('walk_gate_hardware_tight');
    expect(ids).toContain('walk_gates_swing');
    expect(ids).toContain('walk_gate_video');
    expect(ids).toContain('walk_customer_walkthrough');
  });
});

describe('buildChecklistRowsForJob', () => {
  it('returns 32 rows tagged with job_id', () => {
    const rows = buildChecklistRowsForJob('job-uuid-123');
    expect(rows).toHaveLength(32);
    expect(rows.every((r) => r.job_id === 'job-uuid-123')).toBe(true);
  });

  it('rows include section and item_id', () => {
    const rows = buildChecklistRowsForJob('j');
    expect(rows[0]).toHaveProperty('section');
    expect(rows[0]).toHaveProperty('item_id');
    expect(rows[0]).toHaveProperty('label');
  });
});
