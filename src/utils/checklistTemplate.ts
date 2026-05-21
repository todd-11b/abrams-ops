import type { ChecklistSectionKey } from '../types/production';

interface TemplateItem {
  item_id: string;
  label: string;
  skippable: boolean;
  photo_required: boolean;
}

interface TemplateSection {
  section: ChecklistSectionKey;
  title: string;
  photo_description: string | null;
  items: TemplateItem[];
}

export const CHECKLIST_TEMPLATE: TemplateSection[] = [
  {
    section: 'loadout',
    title: 'Morning Loadout',
    photo_description: 'Loaded truck',
    items: [
      { item_id: 'load_job_details_reviewed', label: 'Job details reviewed with crew', skippable: false, photo_required: false },
      { item_id: 'load_cc_video_watched', label: 'CC video watched', skippable: false, photo_required: false },
      { item_id: 'load_811_confirmed', label: '811 confirmed valid', skippable: false, photo_required: false },
      { item_id: 'load_materials_verified', label: 'Materials verified and loaded', skippable: false, photo_required: false },
      { item_id: 'load_vehicle_checks', label: 'Vehicle checks complete', skippable: false, photo_required: false },
      { item_id: 'load_specialty_tools', label: 'Specialty tools loaded', skippable: false, photo_required: false },
      { item_id: 'load_fuel_card', label: 'Fuel card confirmed', skippable: false, photo_required: false },
      { item_id: 'load_clocked_in', label: 'Everyone clocked in', skippable: false, photo_required: false },
    ],
  },
  {
    section: 'onsite',
    title: 'On Site',
    photo_description: 'Before photo, full yard',
    items: [
      { item_id: 'onsite_customer_notified', label: 'Customer notified of arrival', skippable: false, photo_required: false },
      { item_id: 'onsite_site_walk', label: 'Site walk completed', skippable: false, photo_required: false },
      { item_id: 'onsite_ends_corners_verified', label: 'Ends, corners, gates, utilities verified', skippable: false, photo_required: false },
      { item_id: 'onsite_sprinklers_confirmed', label: 'Sprinkler locations confirmed', skippable: true, photo_required: false },
      { item_id: 'onsite_tarps_set', label: 'Tarps and yard protection set', skippable: false, photo_required: false },
      { item_id: 'onsite_layout_method', label: 'Layout method identified', skippable: false, photo_required: false },
      { item_id: 'onsite_key_posts_located', label: 'Key posts located', skippable: false, photo_required: false },
    ],
  },
  {
    section: 'install',
    title: 'Install',
    photo_description: 'Mid-install progress',
    items: [
      { item_id: 'install_phase_1', label: 'Phase 1 complete — holes dug / posts driven, key posts set', skippable: false, photo_required: false },
      { item_id: 'install_phase_2', label: 'Phase 2 complete — posts set, gate posts set, dirt work done', skippable: false, photo_required: false },
      { item_id: 'install_phase_3', label: 'Phase 3 complete — rails attached, balancing done', skippable: false, photo_required: false },
      { item_id: 'install_phase_4', label: 'Phase 4 complete — pickets/panels installed', skippable: false, photo_required: false },
      { item_id: 'install_phase_5', label: 'Phase 5 complete — gates hung, ins and outs done', skippable: true, photo_required: false },
    ],
  },
  {
    section: 'clean',
    title: 'Clean Site',
    photo_description: 'After photo, full yard',
    items: [
      { item_id: 'clean_magnet_sweep', label: 'Magnet sweep — full perimeter', skippable: false, photo_required: false },
      { item_id: 'clean_debris_removed', label: 'All debris and scrap removed', skippable: false, photo_required: false },
      { item_id: 'clean_soil_raked', label: 'Disturbed soil raked and leveled', skippable: false, photo_required: false },
      { item_id: 'clean_hard_surfaces', label: 'Hard surfaces blown off', skippable: false, photo_required: false },
      { item_id: 'clean_staging_cleared', label: 'Staging area cleared', skippable: false, photo_required: false },
      { item_id: 'clean_sprinkler_inspection', label: 'Sprinkler inspection — no damage confirmed', skippable: true, photo_required: false },
    ],
  },
  {
    section: 'walkthrough',
    title: 'Final Walkthrough',
    photo_description: null,
    items: [
      { item_id: 'walk_post_plumb', label: 'Post plumb verified', skippable: false, photo_required: false },
      { item_id: 'walk_straight_line', label: 'Straight line confirmed', skippable: false, photo_required: false },
      { item_id: 'walk_gate_hardware_tight', label: 'All gate hardware tight', skippable: true, photo_required: false },
      { item_id: 'walk_gates_swing', label: 'Gates swing and latch correctly', skippable: true, photo_required: false },
      { item_id: 'walk_gate_video', label: 'Gate video recorded', skippable: true, photo_required: false },
      { item_id: 'walk_customer_walkthrough', label: 'Final walkthrough completed with customer', skippable: true, photo_required: false },
    ],
  },
];

export interface ChecklistRowSeed {
  job_id: string;
  section: ChecklistSectionKey;
  item_id: string;
  label: string;
  skippable: boolean;
  photo_required: boolean;
}

export function buildChecklistRowsForJob(jobId: string): ChecklistRowSeed[] {
  const rows: ChecklistRowSeed[] = [];
  for (const sec of CHECKLIST_TEMPLATE) {
    for (const item of sec.items) {
      rows.push({
        job_id: jobId,
        section: sec.section,
        item_id: item.item_id,
        label: item.label,
        skippable: item.skippable,
        photo_required: item.photo_required,
      });
    }
  }
  return rows;
}

export function getSectionTemplate(section: ChecklistSectionKey): TemplateSection | undefined {
  return CHECKLIST_TEMPLATE.find((s) => s.section === section);
}
