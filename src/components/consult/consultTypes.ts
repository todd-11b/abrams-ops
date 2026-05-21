export interface FenceLineItem {
  id: string;
  label?: string;
  style: string;
  linearFeet: number;
  pricePerSection: number;
  position?: { x: number; y: number };
  rotation?: number; // in degrees
  crewNote?: string;
}

export interface GateInstance {
  id: string;
  type: "walk" | "double";
  position?: { x: number; y: number };
  rotation?: number;
  swing?: "in-left" | "in-right" | "out-left" | "out-right";
}

export interface Obstruction {
  id: string;
  type: "tree" | "pool" | "utility" | "house" | "other";
  position: { x: number; y: number };
  width: number;
  height: number;
  rotation: number;
}

export interface GateItem {
  walk: { qty: number; price: number };
  double: { qty: number; price: number };
}

export interface AddOns {
  demo: { enabled: boolean; lf: number; pricePerLf: number };
  stain: { enabled: boolean; sf: number; pricePerSf: number };
  poolLatch: { enabled: boolean; qty: number; priceEach: number };
}

export interface ConsultFormData {
  // ... keep existing code (Contact)
  contactId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  pipelineStage: string;
  opportunityId: string;

  // Section 1: Property & Yard
  propertyAddress: string;
  hoaApproval: "Yes" | "No" | "Unsure" | "";
  sprinklers: "Yes" | "No" | "Unknown" | "";
  lotNotes: string;
  yardSensitivity: string;
  cleanSiteRisks: string;
  petConsiderations: string;

  // Section 2: Fence Lines
  fenceType: string;
  fenceLines: FenceLineItem[];

  // Section 3: Gates
  gates: GateItem;
  gateInstances: GateInstance[];

  // Visual Layout Additions
  obstructions: Obstruction[];

  // Section 4: Add-ons
  // ... keep existing code
  addOns: AddOns;

  // Section 5: Purpose & Timeline
  purposes: string[];
  timeline: string;

  // Section 6: Photos
  photos: File[];

  // Section 7: Notes
  consultantNotes: string;

  // Proposal metadata
  proposalId: string;
  proposalStatus: "Draft" | "Sent" | "Accepted" | "Declined" | "Expired" | "Ready";
  proposalSentDate: string;
  proposalLink?: string;
  invoiceId?: string;
  invoiceStatus?: "Draft" | "Sent" | "Paid" | "Overdue";
  invoiceLink?: string;
}

export interface FenceStyle {
  label: string;
  pricePerSection: number;
  materialCostPerSection: number;
  spacingFt: number;
  category: string;
  tag: string;
}

export const FENCE_STYLES: Record<string, FenceStyle> = {
  "wood_pine_6": {
    label: "6' Treated Pine Dog Ear",
    pricePerSection: 240,
    materialCostPerSection: 80.00,
    spacingFt: 8,
    category: "Wood",
    tag: "Service – Wood",
  },
  "wood_cedar_6": {
    label: "6' Cedar Dog Ear",
    pricePerSection: 296,
    materialCostPerSection: 130.77,
    spacingFt: 8,
    category: "Wood",
    tag: "Service – Wood",
  },
  "wood_horiz_6": {
    label: "6' Cedar Horizontal",
    pricePerSection: 336,
    materialCostPerSection: 129.85,
    spacingFt: 8,
    category: "Wood",
    tag: "Service – Wood",
  },
  "vinyl_privacy_6": {
    label: "6' Vinyl Privacy",
    pricePerSection: 360,
    materialCostPerSection: 155.00,
    spacingFt: 8,
    category: "Vinyl",
    tag: "Service – Vinyl",
  },
  "vinyl_semi_4": {
    label: "4' Vinyl Semi-Privacy",
    pricePerSection: 280,
    materialCostPerSection: 120.00,
    spacingFt: 8,
    category: "Vinyl",
    tag: "Service – Vinyl",
  },
  "alum_3rail_4": {
    label: "4' Black Aluminum 3-Rail",
    pricePerSection: 320,
    materialCostPerSection: 162.40,
    spacingFt: 8,
    category: "Aluminum",
    tag: "Service – Metal / Ornamental",
  },
  "alum_flat_6": {
    label: "6' Black Aluminum Flat Top",
    pricePerSection: 400,
    materialCostPerSection: 213.70,
    spacingFt: 8,
    category: "Aluminum",
    tag: "Service – Metal / Ornamental",
  },
  "chain_galv_4": {
    label: "4' Galvanized Chain Link",
    pricePerSection: 260,
    materialCostPerSection: 90.00,
    spacingFt: 10,
    category: "Chain Link",
    tag: "Service – Chain Link",
  },
  "chain_black_4": {
    label: "4' Black Chain Link",
    pricePerSection: 300,
    materialCostPerSection: 105.00,
    spacingFt: 10,
    category: "Chain Link",
    tag: "Service – Chain Link",
  },
};

export const FENCE_TYPE_OPTIONS = [
  "Wood",
  "Vinyl",
  "Metal",
  "Chain Link",
  "No-Dig",
  "Unsure",
];

export const TIMELINE_OPTIONS = [
  "ASAP",
  "1–2 Weeks",
  "1 Month",
  "2–3 Months",
  "No Rush",
];

export const PURPOSE_OPTIONS = [
  "Dogs",
  "Kids",
  "Privacy",
  "Pool",
  "HOA Requirement",
  "Other",
];

export const FENCE_TYPE_TO_TAG: Record<string, string> = {
  Wood: "Service – Wood",
  Vinyl: "Service – Vinyl",
  Metal: "Service – Metal / Ornamental",
  "Chain Link": "Service – Chain Link",
  "No-Dig": "Service – No-Dig",
  Unsure: "",
};

export function calcSections(lf: number, spacingFt: number): number {
  if (!lf || !spacingFt) return 0;
  return Math.ceil(lf / spacingFt);
}

export function calcTotals(form: ConsultFormData) {
  let fenceTotal = 0;
  let materialCostTotal = 0;

  const lineBreakdown: Array<{
    label: string;
    runName: string;
    lf: number;
    sections: number;
    pricePerSection: number;
    materialCostPerSection: number;
    lineTotal: number;
    materialLineTotal: number;
  }> = [];

  const materialSummary: Record<string, { label: string; qty: number; unit: string }> = {};

  const addMaterial = (key: string, label: string, qty: number, unit: string) => {
    if (!materialSummary[key]) {
      materialSummary[key] = { label, qty, unit };
    } else {
      materialSummary[key].qty += qty;
    }
  };

  for (const line of form.fenceLines) {
    let style: FenceStyle | undefined = FENCE_STYLES[line.style];
    // Fallback for legacy data that might have saved labels instead of keys
    if (!style) {
      style = Object.values(FENCE_STYLES).find(s => s.label === line.style);
    }
    if (!style) continue;
    const sections = calcSections(line.linearFeet, style.spacingFt);
    const lineTotal = sections * line.pricePerSection;
    const materialLineTotal = sections * style.materialCostPerSection;
    fenceTotal += lineTotal;
    materialCostTotal += materialLineTotal;

    // Detailed material tracking
    addMaterial(`${line.style}_posts`, `${style.label} Posts`, sections + 1, "pcs");
    if (style.category === "Wood") {
      addMaterial(`${line.style}_rails`, `${style.label} Rails`, sections * 3, "pcs");
      addMaterial(`${line.style}_pickets`, `${style.label} Pickets`, sections * 18, "pcs");
    } else if (style.category === "Vinyl" || style.category === "Aluminum") {
      addMaterial(`${line.style}_panels`, `${style.label} Panels`, sections, "pcs");
    } else if (style.category === "Chain Link") {
      addMaterial(`${line.style}_fabric`, `${style.label} Fabric`, line.linearFeet, "LF");
    }

    lineBreakdown.push({
      label: style.label,
      runName: line.label || "Main Run",
      lf: line.linearFeet,
      sections,
      pricePerSection: line.pricePerSection,
      materialCostPerSection: style.materialCostPerSection,
      lineTotal,
      materialLineTotal,
    });
  }

  const walkGateTotal = form.gates.walk.qty * form.gates.walk.price;
  const doubleGateTotal = form.gates.double.qty * form.gates.double.price;
  const gateTotal = walkGateTotal + doubleGateTotal;

  const demoTotal = form.addOns.demo.enabled ? form.addOns.demo.lf * form.addOns.demo.pricePerLf : 0;
  const stainTotal = form.addOns.stain.enabled ? form.addOns.stain.sf * form.addOns.stain.pricePerSf : 0;
  const poolLatchTotal = form.addOns.poolLatch.enabled ? form.addOns.poolLatch.qty * form.addOns.poolLatch.priceEach : 0;
  const addonTotal = demoTotal + stainTotal + poolLatchTotal;

  const grandTotal = fenceTotal + gateTotal + addonTotal;
  const deposit = Math.round(grandTotal * 0.5);
  const balance = grandTotal - deposit;

  // Internal numbers
  const internalEstimate = materialCostTotal * 2.5;
  const sellPrice = grandTotal;
  const margin = sellPrice > 0 ? ((sellPrice - internalEstimate) / sellPrice) * 100 : 0;

  // Labor benchmark: sections × 0.47 S/H × $25/hr
  const totalSections = lineBreakdown.reduce((s, l) => s + l.sections, 0);
  const laborBenchmark = totalSections * 0.47 * 25;

  return {
    fenceTotal,
    gateTotal,
    walkGateTotal,
    doubleGateTotal,
    demoTotal,
    stainTotal,
    poolLatchTotal,
    addonTotal,
    grandTotal,
    deposit,
    balance,
    materialCostTotal,
    internalEstimate,
    sellPrice,
    margin,
    laborBenchmark,
    lineBreakdown,
    totalSections,
    materialList: Object.values(materialSummary),
  };
}

export function generateProposalId(): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `AFC-${year}-${rand}`;
}

export function calcMaterialsCost(
  lines: FenceLineItem[],
  gates: GateItem,
  addOns: AddOns
): number {
  let total = 0;
  for (const line of lines) {
    let style: FenceStyle | undefined = FENCE_STYLES[line.style];
    if (!style) {
      style = Object.values(FENCE_STYLES).find(s => s.label === line.style);
    }
    if (!style) continue;
    const sections = calcSections(line.linearFeet, style.spacingFt);
    total += sections * line.pricePerSection;
  }
  total += gates.walk.qty * gates.walk.price;
  total += gates.double.qty * gates.double.price;
  if (addOns.demo.enabled) total += addOns.demo.lf * addOns.demo.pricePerLf;
  if (addOns.stain.enabled) total += addOns.stain.sf * addOns.stain.pricePerSf;
  if (addOns.poolLatch.enabled) total += addOns.poolLatch.qty * addOns.poolLatch.priceEach;
  return total;
}

export interface InvoicePayload {
  altId: string;
  altType: "location";
  contactId: string;
  name: string;
  currency: string;
  status: "draft" | "sent";
  issueDate: string;
  dueDate: string;
  title: string;
  items: Array<{
    name: string;
    description: string;
    qty: number;
    amount: number;
    currency: string;
  }>;
  contactDetails: {
    id: string;
    name: string;
    email: string;
    phoneNo: string;
  };
  businessDetails: {
    name: string;
    phoneNo: string;
    address: {
      addressLine1: string;
      city: string;
      state: string;
      zipCode: string;
      countryCode: string;
    };
  };
  discount: {
    type: "percentage" | "amount";
    value: number;
  };
  sentTo: {
    email: string[];
  };
}
