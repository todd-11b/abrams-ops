import {
  FENCE_STYLES,
  calcTotals,
  generateProposalId,
  type ConsultFormData,
  type FenceStyle,
} from '../../../src/components/consult/consultTypes';

export const JSON_FIELD_ID = 'v74WeVuNKTrjnYGM6ICN';

export const DEFAULT_WALK_GATE = 425;
export const DEFAULT_DOUBLE_GATE = 850;
export const DEFAULT_DEMO_PER_LF = 7;
export const DEFAULT_STAIN_PER_SF = 2.5;
export const DEFAULT_POOL_LATCH = 150;

const STYLE_ALIASES: Record<string, string> = {
  cedar: 'wood_cedar_6',
  '6 cedar': 'wood_cedar_6',
  '6ft cedar': 'wood_cedar_6',
  '6 foot cedar': 'wood_cedar_6',
  'cedar dog ear': 'wood_cedar_6',
  pine: 'wood_pine_6',
  'treated pine': 'wood_pine_6',
  '6 pine': 'wood_pine_6',
  horizontal: 'wood_horiz_6',
  'cedar horizontal': 'wood_horiz_6',
  vinyl: 'vinyl_privacy_6',
  'vinyl privacy': 'vinyl_privacy_6',
  '6 vinyl': 'vinyl_privacy_6',
  'vinyl semi': 'vinyl_semi_4',
  'semi privacy': 'vinyl_semi_4',
  aluminum: 'alum_3rail_4',
  'aluminum 3 rail': 'alum_3rail_4',
  '3 rail': 'alum_3rail_4',
  'flat top': 'alum_flat_6',
  'aluminum flat': 'alum_flat_6',
  'chain link': 'chain_galv_4',
  galvanized: 'chain_galv_4',
  'galv chain': 'chain_galv_4',
  'black chain': 'chain_black_4',
  'black chain link': 'chain_black_4',
};

export interface QuoteInput {
  style?: string;
  linearFeet?: number;
  walkGates?: number;
  doubleGates?: number;
  demoLf?: number;
  stainSf?: number;
  poolLatchQty?: number;
  contactId?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  propertyAddress?: string;
  label?: string;
}

export interface ResolvedStyle {
  key: string;
  style: FenceStyle;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function qty(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function feet(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function normalizeStyleQuery(value: string): string {
  return value.toLowerCase().replace(/['’]/g, '').replace(/feet|foot|ft\.?/g, 'ft').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function resolveStyle(raw: string | undefined): ResolvedStyle | null {
  const original = clean(raw);
  if (!original) return null;
  if (FENCE_STYLES[original]) return { key: original, style: FENCE_STYLES[original] };
  const byLabel = Object.entries(FENCE_STYLES).find(([, style]) => style.label.toLowerCase() === original.toLowerCase());
  if (byLabel) return { key: byLabel[0], style: byLabel[1] };
  const normalized = normalizeStyleQuery(original);
  const aliased = STYLE_ALIASES[normalized];
  if (aliased && FENCE_STYLES[aliased]) return { key: aliased, style: FENCE_STYLES[aliased] };
  const fuzzy = Object.entries(FENCE_STYLES).find(([key, style]) => {
    const hay = `${key} ${style.label} ${style.category}`.toLowerCase();
    return normalized.split(' ').every((part) => part.length > 1 && hay.includes(part));
  });
  return fuzzy ? { key: fuzzy[0], style: fuzzy[1] } : null;
}

export function listStyles() {
  return Object.entries(FENCE_STYLES).map(([key, style]) => ({
    key,
    label: style.label,
    category: style.category,
    pricePerSection: style.pricePerSection,
    spacingFt: style.spacingFt,
  }));
}

function emptyForm(): ConsultFormData {
  return {
    contactId: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    pipelineStage: '',
    opportunityId: '',
    propertyAddress: '',
    hoaApproval: '',
    sprinklers: '',
    lotNotes: '',
    yardSensitivity: '',
    cleanSiteRisks: '',
    petConsiderations: '',
    fenceType: '',
    fenceLines: [],
    gates: {
      walk: { qty: 0, price: DEFAULT_WALK_GATE },
      double: { qty: 0, price: DEFAULT_DOUBLE_GATE },
    },
    gateInstances: [],
    obstructions: [],
    addOns: {
      demo: { enabled: false, lf: 0, pricePerLf: DEFAULT_DEMO_PER_LF },
      stain: { enabled: false, sf: 0, pricePerSf: DEFAULT_STAIN_PER_SF },
      poolLatch: { enabled: false, qty: 0, priceEach: DEFAULT_POOL_LATCH },
    },
    purposes: [],
    timeline: '',
    photos: [],
    consultantNotes: '',
    proposalId: generateProposalId(),
    proposalStatus: 'Draft',
    proposalSentDate: '',
  };
}

export function parseQuoteInput(body: unknown): { input: QuoteInput; error?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { input: {}, error: 'JSON object required' };
  const raw = body as Record<string, unknown>;
  const input: QuoteInput = {
    style: clean(raw.style) || undefined,
    linearFeet: feet(raw.linearFeet ?? raw.lf ?? raw.feet),
    walkGates: qty(raw.walkGates ?? raw.walk),
    doubleGates: qty(raw.doubleGates ?? raw.double),
    demoLf: feet(raw.demoLf ?? raw.demo),
    stainSf: feet(raw.stainSf ?? raw.stain),
    poolLatchQty: qty(raw.poolLatchQty ?? raw.poolLatch),
    contactId: clean(raw.contactId) || undefined,
    contactName: clean(raw.contactName ?? raw.name) || undefined,
    contactPhone: clean(raw.contactPhone ?? raw.phone) || undefined,
    contactEmail: clean(raw.contactEmail ?? raw.email) || undefined,
    propertyAddress: clean(raw.propertyAddress ?? raw.address) || undefined,
    label: clean(raw.label) || undefined,
  };
  return { input };
}

export function contactIdValid(value: string | undefined): value is string {
  return !!value && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

export function buildQuoteForm(input: QuoteInput, existing?: ConsultFormData | null): { form: ConsultFormData; resolved: ResolvedStyle } | { error: string } {
  const resolved = resolveStyle(input.style);
  if (!resolved) return { error: 'unknown fence style' };
  const lf = input.linearFeet ?? 0;
  if (lf <= 0) return { error: 'linearFeet must be greater than 0' };

  const form = existing ? structuredClone(existing) : emptyForm();
  form.fenceType = resolved.style.category;
  form.fenceLines = [{
    id: form.fenceLines[0]?.id || crypto.randomUUID(),
    label: input.label || form.fenceLines[0]?.label || 'Main Run',
    style: resolved.key,
    linearFeet: lf,
    pricePerSection: resolved.style.pricePerSection,
  }];
  form.gates = {
    walk: { qty: input.walkGates ?? 0, price: form.gates?.walk?.price || DEFAULT_WALK_GATE },
    double: { qty: input.doubleGates ?? 0, price: form.gates?.double?.price || DEFAULT_DOUBLE_GATE },
  };
  const demoLf = input.demoLf ?? 0;
  const stainSf = input.stainSf ?? 0;
  const latchQty = input.poolLatchQty ?? 0;
  form.addOns = {
    demo: { enabled: demoLf > 0, lf: demoLf, pricePerLf: form.addOns?.demo?.pricePerLf || DEFAULT_DEMO_PER_LF },
    stain: { enabled: stainSf > 0, sf: stainSf, pricePerSf: form.addOns?.stain?.pricePerSf || DEFAULT_STAIN_PER_SF },
    poolLatch: { enabled: latchQty > 0, qty: latchQty, priceEach: form.addOns?.poolLatch?.priceEach || DEFAULT_POOL_LATCH },
  };
  if (input.contactId) form.contactId = input.contactId;
  if (input.contactName) form.contactName = input.contactName;
  if (input.contactPhone) form.contactPhone = input.contactPhone;
  if (input.contactEmail) form.contactEmail = input.contactEmail;
  if (input.propertyAddress) form.propertyAddress = input.propertyAddress;
  if (!form.proposalId) form.proposalId = generateProposalId();
  if (!form.proposalStatus) form.proposalStatus = 'Draft';
  return { form, resolved };
}

export function quotePayload(form: ConsultFormData, resolved: ResolvedStyle) {
  const totals = calcTotals(form);
  const spoken = [
    `$${totals.grandTotal.toLocaleString('en-US')} total`,
    `$${totals.deposit.toLocaleString('en-US')} deposit`,
    `${totals.totalSections} sections of ${resolved.style.label}`,
    `${form.fenceLines[0]?.linearFeet ?? 0} feet`,
    form.gates.walk.qty ? `${form.gates.walk.qty} walk gate${form.gates.walk.qty === 1 ? '' : 's'}` : null,
    form.gates.double.qty ? `${form.gates.double.qty} double gate${form.gates.double.qty === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join('. ') + '.';
  return {
    style: { key: resolved.key, label: resolved.style.label, category: resolved.style.category },
    linearFeet: form.fenceLines[0]?.linearFeet ?? 0,
    totals: {
      grandTotal: totals.grandTotal,
      deposit: totals.deposit,
      balance: totals.balance,
      fenceTotal: totals.fenceTotal,
      gateTotal: totals.gateTotal,
      addonTotal: totals.addonTotal,
      sections: totals.totalSections,
      margin: Math.round(totals.margin),
      laborBenchmark: totals.laborBenchmark,
    },
    materialList: totals.materialList,
    spoken,
    proposalId: form.proposalId,
  };
}
