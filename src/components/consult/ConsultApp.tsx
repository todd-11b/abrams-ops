import { useState, useEffect } from "react";
import { ChevronDown, Phone, Loader2, CheckCircle, AlertCircle, UserPlus, Users } from "lucide-react";
// @ts-ignore
import { PropertySection } from "./PropertySection";
// @ts-ignore
import { MeasurementsSection } from "./MeasurementsSection";
// @ts-ignore
import { VisualLayoutSection } from "./VisualLayoutSection";
// @ts-ignore
import { GatesSection } from "./GatesSection";
// @ts-ignore
import { AddOnsSection } from "./AddOnsSection";
// @ts-ignore
import { PurposeSection } from "./PurposeSection";
// @ts-ignore
import { PhotosSection } from "./PhotosSection";
// @ts-ignore
import { ProposalView } from "./ProposalView";
// @ts-ignore
import { SignPayView } from "./SignPayView";
// @ts-ignore
import { crmApi } from "../../lib/crm-api";
import {
  ConsultFormData,
  FENCE_STYLES,
  FENCE_TYPE_TO_TAG,
  calcTotals,
  generateProposalId,
} from "./consultTypes";

type AppStep = "consult" | "proposal" | "signpay";

const defaultForm = (): ConsultFormData => ({
  contactId: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  pipelineStage: "",
  opportunityId: "",
  propertyAddress: "",
  hoaApproval: "",
  sprinklers: "",
  lotNotes: "",
  yardSensitivity: "",
  cleanSiteRisks: "",
  petConsiderations: "",
  fenceType: "",
  fenceLines: [
    {
      id: crypto.randomUUID(),
      label: "Main Run",
      style: "wood_pine_6",
      linearFeet: 0,
      pricePerSection: FENCE_STYLES["wood_pine_6"].pricePerSection,
    },
  ],
  gates: {
    walk: { qty: 0, price: 425 },
    double: { qty: 0, price: 850 },
  },
  gateInstances: [],
  obstructions: [],
  addOns: {
    demo: { enabled: false, lf: 0, pricePerLf: 7 },
    stain: { enabled: false, sf: 0, pricePerSf: 2.5 },
    poolLatch: { enabled: false, qty: 0, priceEach: 150 },
  },
  purposes: [],
  timeline: "",
  photos: [],
  consultantNotes: "",
  proposalId: generateProposalId(),
  proposalStatus: "Draft",
  proposalSentDate: "",
});

interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  stage: string;
  opportunityId: string;
}

function cur(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const SECTIONS = [
  "Property & Yard Conditions",
  "Fence Measurements",
  "Gates",
  "Visual Layout",
  "Add-ons",
  "Purpose & Timeline",
  "Photos",
  "Consultant Notes",
];

export const ConsultApp = () => {
  const [step, setStep] = useState<AppStep>("consult");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [form, setForm] = useState<ConsultFormData>(defaultForm());
  const [openSection, setOpenSection] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [localDrafts, setLocalDrafts] = useState<any[]>([]);

  useEffect(() => {
    const draftsObj = JSON.parse(localStorage.getItem("abrams_drafts") || "{}");
    const draftsArr = Object.values(draftsObj).sort((a: any, b: any) => (b as any).timestamp - (a as any).timestamp);
    setLocalDrafts(draftsArr);
  }, [step, selectedContact]);

  useEffect(() => {
    const fetchContacts = async () => {
      try {
        const json = await crmApi.fetchContacts();
        const contactList = json.contacts || [];
        const list: Contact[] = contactList.map((c: any) => ({
          id: c.id,
          name: `${c.firstName || ""} ${c.lastName || ""}`.trim() || "Unknown",
          phone: c.phone || "",
          email: c.email || "",
          address: c.address1 || "",
          stage: "Contact",
          opportunityId: "",
        }));
        setContacts(list);
      } catch (err) {
        console.error("Fetch contacts failed", err);
        setContacts([]);
      } finally {
        setLoadingContacts(false);
      }
    };
    fetchContacts();
  }, []);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 3) return;

    setSearching(true);
    try {
      const json = await crmApi.searchContacts(query);
      const found: Contact[] = (json.contacts || []).map((c: any) => ({
        id: c.id,
        name: `${c.firstName || ""} ${c.lastName || ""}`.trim() || "Unknown",
        phone: c.phone || "",
        email: c.email || "",
        address: c.address1 || "",
        stage: "Contact",
        opportunityId: "",
      }));

      setContacts(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const newOnes = found.filter(f => !existingIds.has(f.id));
        return [...prev, ...newOnes];
      });
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setSearching(false);
    }
  };

  const selectContact = async (c: Contact) => {
    setSelectedContact(c);
    setSearching(true);
    setSaveStatus("idle");

    try {
      console.log("FETCHING CONTACT:", c.id);
      const res = await crmApi.getContact(c.id);
      const contact = res.contact;

      // Try to find the job_line_items_json field
      const jsonField = contact.customFields?.find((f: any) =>
        f.id === "v74WeVuNKTrjnYGM6ICN" ||
        f.key === "contact.job_line_items_json" ||
        f.key === "job_line_items_json"
      );

      if (jsonField && jsonField.value) {
        try {
          console.log("LOADING PROPOSAL FROM CRM");
          const formData = JSON.parse(jsonField.value);

          // Ensure we have at least one fence line
          if (!formData.fenceLines || formData.fenceLines.length === 0) {
            formData.fenceLines = [
              {
                id: crypto.randomUUID(),
                label: "Main Run",
                style: "wood_pine_6",
                linearFeet: 0,
                pricePerSection: FENCE_STYLES["wood_pine_6"].pricePerSection,
              }
            ];
          }

          setForm({
            ...formData,
            contactId: c.id,
            contactName: c.name,
            contactPhone: c.phone,
            contactEmail: c.email,
          });
          setSearching(false);
          return;
        } catch (e) {
          console.error("Failed to parse CRM proposal JSON", e);
        }
      }
    } catch (err) {
      console.error("Fetch full contact failed", err);
    }

    // Fallback to local drafts if CRM load failed or didn't have data
    const drafts = JSON.parse(localStorage.getItem("abrams_drafts") || "{}");
    const savedDraft = drafts[c.id];

    if (savedDraft && savedDraft.form) {
      console.log("LOADING PROPOSAL FROM LOCAL DRAFT");
      setForm(savedDraft.form);
    } else {
      console.log("STARTING FRESH PROPOSAL");
      setForm(() => ({
        ...defaultForm(),
        contactId: c.id,
        contactName: c.name,
        contactPhone: c.phone,
        contactEmail: c.email,
        propertyAddress: c.address,
        pipelineStage: c.stage,
        opportunityId: c.opportunityId,
      }));
    }
    setSearching(false);
  };

  const startManual = () => {
    if (!manualName.trim()) return;
    const placeholder: Contact = {
      id: "",
      name: manualName.trim(),
      phone: manualPhone.trim(),
      email: "",
      address: "",
      stage: "Walk-In",
      opportunityId: "",
    };
    setSelectedContact(placeholder);
    setForm((prev) => ({
      ...prev,
      contactName: placeholder.name,
      contactPhone: placeholder.phone,
      pipelineStage: "Walk-In",
    }));
  };

  const updateForm = (updates: Partial<ConsultFormData>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  };

  const totals = calcTotals(form);

  const uploadPhotos = async (contactId: string) => {
    if (!contactId || form.photos.length === 0) return;
    for (const photo of form.photos) {
      await crmApi.uploadPhoto(contactId, photo);
    }
  };

  const getServiceTag = () => {
    if (!form.fenceType) return null;
    return FENCE_TYPE_TO_TAG[form.fenceType] || null;
  };

  const saveToGHL = async (markComplete: boolean): Promise<boolean> => {
    setSaving(true);
    setSaveStatus("idle");
    try {
      let currentContactId = form.contactId;
      if (!currentContactId) {
        currentContactId = "local_" + Date.now().toString();
        updateForm({ contactId: currentContactId });
      }

      const drafts = JSON.parse(localStorage.getItem("abrams_drafts") || "{}");
      drafts[currentContactId] = {
        timestamp: Date.now(),
        form: { ...form, contactId: currentContactId }
      };
      localStorage.setItem("abrams_drafts", JSON.stringify(drafts));
      setLocalDrafts(Object.values(drafts).sort((a: any, b: any) => (b as any).timestamp - (a as any).timestamp));

      let realContactId = currentContactId.startsWith("local_") ? null : currentContactId;

      if (!realContactId) {
        const nameParts = form.contactName.trim().split(" ");
        const firstName = nameParts[0] || "Unknown";
        const lastName = nameParts.slice(1).join(" ") || "";

        const createJson = await crmApi.createContact({
          firstName,
          lastName,
          phone: form.contactPhone
        });

        realContactId = createJson.contact.id;
        delete drafts[currentContactId];
        if (realContactId) currentContactId = realContactId;
        drafts[currentContactId || ""] = {
          timestamp: Date.now(),
          form: { ...form, contactId: currentContactId }
        };
        localStorage.setItem("abrams_drafts", JSON.stringify(drafts));
        setLocalDrafts(Object.values(drafts).sort((a: any, b: any) => (b as any).timestamp - (a as any).timestamp));
        updateForm({ contactId: currentContactId || "" });
      } else {
        await crmApi.updateContact(realContactId, { address1: form.propertyAddress });
      }

      if (realContactId) {
        const customFields = [
          { id: "rOo4tVW8Vr1YDqbKx16s", key: "contact.hoa_approval_needed", value: form.hoaApproval },
          { id: "CAbx8EVVvQzlCcHqX7pR", key: "contact.lot_notes__obstacles", value: form.lotNotes },
          { id: "ABTaAvb2VnrSj8hXmikA", key: "contact.sprinklers__irrigation_present", value: form.sprinklers },
          { id: "R2TZeFEepO9slhM2mFXM", key: "contact.fence_type", value: form.fenceType },
          { id: "DbbvUneMXFCeyBjHlYhe", key: "contact.estimated_linear_feet", value: form.fenceLines.reduce((s, l) => s + (l.linearFeet || 0), 0) },
          { id: "QX72GsyyIn0yeHlcpFjm", key: "contact.number_of_gates", value: form.gates.walk.qty + form.gates.double.qty },
          { id: "vzdomE51ZkclKdxiCQWf", key: "contact.purpose", value: form.purposes },
          { id: "XQAMEHbh7GTFwOYjzrIx", key: "contact.timeline", value: form.timeline },
          { id: "3PrhuAaSa4yG1sJJ4zq9", key: "contact.yard_sensitivity", value: form.yardSensitivity },
          { id: "9y5jlK7uW1Jj5NXNZfpA", key: "contact.clean_site_risk_areas", value: form.cleanSiteRisks },
          { id: "6gtaEyET1kHb8x70GYPv", key: "contact.pet_considerations", value: form.petConsiderations },
          { id: "OimgSSfsAlhQwb86Ppb5", key: "contact.internal_estimate_amount", value: totals.internalEstimate },
          { id: "4sYTsRc8X1b2RgYyTYxi", key: "contact.customer_sell_price", value: totals.grandTotal },
          { id: "1aehlMpse8vflbYq2IsW", key: "contact.consultant_notes", value: form.consultantNotes },
          { id: "zDkeO0JsdPV5lc0D4Cwp", key: "contact.consultation_completed_date", value: new Date().toISOString().split('T')[0] },
          { id: "v74WeVuNKTrjnYGM6ICN", key: "contact.job_line_items_json", value: JSON.stringify(form) },
          { id: "v74WeVuNKTrjnYGM6ICN", key: "job_line_items_json", value: JSON.stringify(form) },
          { id: "12YSsRRAQStXYEIGVmea", key: "contact.proposal_id", value: form.proposalId },
          { id: "kWMi7fpdhv9RyPowuU1R", key: "contact.proposal_status", value: form.proposalStatus },
          { id: "TZYAv7GtT9dtIZWrHWO7", key: "contact.proposal_sent_date", value: form.proposalSentDate || new Date().toISOString().split('T')[0] },
        ];

        await crmApi.updateContact(realContactId, { customFields });

        const noteBody = `Estimate Draft Saved\nTotal: $${totals.grandTotal.toFixed(2)}\nInternal: $${totals.internalEstimate.toFixed(2)}\nNotes: ${form.consultantNotes}`;
        await crmApi.addNote(realContactId, noteBody);

        await uploadPhotos(realContactId);

        const tag = getServiceTag();
        if (tag) {
          await crmApi.addTags(realContactId, [tag]);
        }
      }

      if (markComplete && form.opportunityId) {
        await crmApi.updateOpportunityStatus(form.opportunityId, "On-Site Consultation Completed");
      }

      setSaveStatus("success");
      setSaveMessage(markComplete ? "Consultation marked complete!" : "Draft saved successfully.");
      return true;
    } catch (err) {
      console.error(err);
      setSaveStatus("error");
      setSaveMessage("Saved locally, but CRM sync failed.");
      return true;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = async () => {
    await saveToGHL(false);
  };

  const handleContinueToProposal = async () => {
    const ok = await saveToGHL(true);
    if (ok) {
      setForm((prev) => ({ ...prev, proposalStatus: "Draft" }));
      setStep("proposal");
    }
  };

  const handleSendForReview = async (_forceRegenerate = false) => {
    setSending(true);
    setSaveStatus("idle");

    try {
      if (!form.contactId || form.contactId.startsWith("local_")) {
        throw new Error("Please save the contact to the CRM before sending a proposal.");
      }

      // Build proposal link using the existing route format
      const proposalLink = `${window.location.origin}/proposal/${form.contactId}`;

      const updatedForm: ConsultFormData = {
        ...form,
        proposalStatus: "Ready",
        proposalSentDate: new Date().toISOString().split("T")[0],
        proposalLink: proposalLink,
      };

      setForm(updatedForm);

      // Save the updated form back to CRM immediately
      await crmApi.updateContact(form.contactId, {
        customFields: [
          { id: "kWMi7fpdhv9RyPowuU1R", key: "contact.proposal_status", value: "Ready" },
          { id: "TZYAv7GtT9dtIZWrHWO7", key: "contact.proposal_sent_date", value: updatedForm.proposalSentDate },
          { id: "v74WeVuNKTrjnYGM6ICN", key: "contact.job_line_items_json", value: JSON.stringify(updatedForm) },
          { key: "contact.proposal_link", value: proposalLink }
        ]
      });

      setSent(true);
      setSaveStatus("success");
      setSaveMessage("Proposal saved and ready to send.");

      /*
      // Phase 3 invoice creation — disabled for MVP proposal-first flow
      // Check if we already have a valid invoice to avoid duplicates
      if (!forceRegenerate && form.invoiceId) {
        console.log("REUSING EXISTING INVOICE:", form.invoiceId);

        if (!form.invoiceLink) {
           console.log("No link found for existing invoice, we would normally try to fetch it here.");
        } else {
           setSent(true);
           setSaveStatus("success");
           setSaveMessage("Proposal link is already active!");
           setSending(false);
           return;
        }
      }

      // Build items according to the latest V2 schema
      const items = [
        ...totals.lineBreakdown
          .filter(lb => lb.sections > 0)
          .map(lb => ({
            name: `${lb.runName} — ${lb.label}`,
            description: `${lb.lf} LF · ${lb.sections} sections`,
            qty: Number(lb.sections),
            amount: Number(Number(lb.pricePerSection).toFixed(2)),
            currency: "USD"
          })),
        ...(form.gates.walk.qty > 0 ? [{
          name: "Walk Gate",
          description: "Standard Walk Gate",
          qty: Number(form.gates.walk.qty),
          amount: Number(Number(form.gates.walk.price).toFixed(2)),
          currency: "USD"
        }] : []),
        ...(form.gates.double.qty > 0 ? [{
          name: "Double Gate",
          description: "Standard Double Gate",
          qty: Number(form.gates.double.qty),
          amount: Number(Number(form.gates.double.price).toFixed(2)),
          currency: "USD"
        }] : []),
        ...(form.addOns.demo.enabled && (form.addOns.demo.lf || 0) > 0 ? [{
          name: "Demo / Haul-Away",
          description: `${form.addOns.demo.lf} LF Removal`,
          qty: Number(form.addOns.demo.lf),
          amount: Number(Number(form.addOns.demo.pricePerLf).toFixed(2)),
          currency: "USD"
        }] : []),
        ...(form.addOns.stain.enabled && (form.addOns.stain.sf || 0) > 0 ? [{
          name: "Staining",
          description: `${form.addOns.stain.sf} SF Staining`,
          qty: Number(form.addOns.stain.sf),
          amount: Number(Number(form.addOns.stain.pricePerSf).toFixed(2)),
          currency: "USD"
        }] : []),
        ...(form.addOns.poolLatch.enabled && (form.addOns.poolLatch.qty || 0) > 0 ? [{
          name: "Pool / Magna Latch Upgrade",
          description: "Safety Latch Upgrade",
          qty: Number(form.addOns.poolLatch.qty),
          amount: Number(Number(form.addOns.poolLatch.priceEach).toFixed(2)),
          currency: "USD"
        }] : []),
      ];

      if (items.length === 0) {
        throw new Error("Cannot send an empty proposal. Please add measurements or gates first.");
      }

      console.log("SENDING PROPOSAL WITH ITEMS:", items);

      const result = await crmApi.createAndSendInvoice({
        contactId: form.contactId,
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
        items,
        issueDate: new Date().toISOString().split("T")[0],
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      });

      console.log("INVOICE CREATION RESULT:", JSON.stringify(result, null, 2));

      let invoiceLink = "";
      if (result.details) {
        // Try common URL fields
        const d = result.details.invoice || result.details;
        invoiceLink = d.invoiceUrl || d.publicViewUrl || d.sourceUrl || d.url || d.paymentUrl || d.hostedInvoiceUrl || "";

        if (!invoiceLink) {
          console.warn("URL not found in details, checking all string fields...");
          const findUrl = (obj: any): string => {
            for (const k in obj) {
              if (typeof obj[k] === "string" && (k.toLowerCase().includes("url") || k.toLowerCase().includes("link")) && obj[k].startsWith("http")) return obj[k];
              if (obj[k] && typeof obj[k] === "object") {
                const found = findUrl(obj[k]);
                if (found) return found;
              }
            }
            return "";
          };
          invoiceLink = findUrl(result.details);
        }
      }

      console.log("FINAL CAPTURED INVOICE LINK:", invoiceLink);

      if (form.opportunityId) {
        await crmApi.updateOpportunityStatus(form.opportunityId, "Invoice Requested");
      }

      const updatedForm: ConsultFormData = {
        ...form,
        proposalStatus: "Sent",
        proposalSentDate: new Date().toISOString().split("T")[0],
        invoiceId: result.invoiceId,
        invoiceLink: invoiceLink || undefined,
      };

      setForm(updatedForm);

      // Save the updated form with invoice info back to CRM immediately
      await crmApi.updateContact(form.contactId, {
        customFields: [
          { id: "v74WeVuNKTrjnYGM6ICN", key: "contact.job_line_items_json", value: JSON.stringify(updatedForm) }
        ]
      });

      setSent(true);
      setSaveStatus("success");
      setSaveMessage("Proposal and Invoice sent successfully!");
      */
    } catch (err: any) {
      console.error("handleSendForReview failed:", err);
      let errMsg = err.message || "Failed to send proposal.";
      if (errMsg.includes("userId or sentFrom")) {
        errMsg = "CRM Configuration Error: The sender identity is missing in the CRM API call.";
      } else if (errMsg.includes("items should not be empty")) {
        errMsg = "Error: Cannot send a proposal with no items. Please ensure measurements are entered.";
      }
      setSaveStatus("error");
      setSaveMessage(errMsg);
    } finally {
      setSending(false);
    }
  };

  const handleSendToCustomer = async () => {
    if (!form.contactId || !form.proposalLink) {
      setSaveStatus("error");
      setSaveMessage("Missing contact or proposal link.");
      return;
    }

    try {
      const today = new Date().toISOString().split("T")[0];
      await crmApi.updateContact(form.contactId, {
        customFields: [
          { id: "kWMi7fpdhv9RyPowuU1R", key: "contact.proposal_status", value: "Sent" },
          { id: "TZYAv7GtT9dtIZWrHWO7", key: "contact.proposal_sent_date", value: today }
        ]
      });

      if (form.opportunityId) {
        // Find the stage ID for "Proposal Sent" by calling getPipelines in the background
        crmApi.getPipelines().then(res => {
          const pipeline = res.pipelines?.find((p: any) => p.id === "afca3dmAyyMoiEbF5Hvy");
          const stage = pipeline?.stages?.find((s: any) => s.name === "Proposal Sent");
          if (stage) {
            crmApi.updateOpportunityStatus(form.opportunityId, "open", stage.id);
          }
        }).catch(err => console.error("Failed to fetch pipeline stages", err));
      }

      setForm((prev) => ({
        ...prev,
        proposalStatus: "Sent",
        proposalSentDate: today,
      }));

      setSaveStatus("success");
      setSaveMessage("Proposal marked as sent.");
    } catch (error) {
      console.error("Failed to mark proposal as sent:", error);
      setSaveStatus("error");
      setSaveMessage("Failed to update CRM.");
      throw error;
    }
  };

  const toggleSection = (idx: number) => setOpenSection(openSection === idx ? -1 : idx);

  if (step === "proposal") {
    return (
      <ProposalView
        form={form}
        totals={calcTotals(form)}
        onBack={() => setStep("consult")}
        onPresent={() => setStep("signpay")}
        onSendForReview={() => handleSendForReview(false)}
        onRegenerateInvoice={() => handleSendForReview(true)}
        onSendToCustomer={handleSendToCustomer}
        sending={sending}
        sent={sent}
      />
    );
  }

  if (step === "signpay") {
    return (
      <SignPayView
        form={form}
        onBack={() => setStep("proposal")}
      />
    );
  }

  if (!selectedContact) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-[#0a1f3d] px-4 pt-10 pb-6 relative">
          <img src="https://vibe.filesafe.space/1778961049274125424/assets/7a08ba12-4d80-4131-ad78-bd01283acbf1.png" alt="Abrams Fence Co." className="h-10 object-contain mb-4" />
          <h1 className="text-white text-xl font-bold">On-Site Consult</h1>
          <p className="text-white/60 text-sm mt-1">
            {showManualEntry ? "Enter customer details" : "Select a customer or start a walk-in"}
          </p>
        </div>

        <div className="flex-1 px-4 py-5 space-y-3">
          <div className="relative mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search customers..."
              className="w-full rounded-2xl border border-gray-200 px-11 py-4 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30"
            />
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
              {searching ? <Loader2 size={18} className="animate-spin" /> : <Users size={18} />}
            </div>
          </div>

          {!showManualEntry ? (
            <button onClick={() => setShowManualEntry(true)} className="w-full bg-[#0a1f3d] rounded-2xl p-4 text-left shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                <UserPlus size={20} className="text-white" />
              </div>
              <div>
                <p className="font-bold text-white text-base">New / Walk-In Customer</p>
                <p className="text-white/60 text-xs mt-0.5">Start a consult without an existing record</p>
              </div>
            </button>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <UserPlus size={16} className="text-[#0a1f3d]" />
                <span className="font-bold text-[#0a1f3d] text-sm">New / Walk-In Customer</span>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Customer Name *</label>
                <input type="text" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="First Last" className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30" autoFocus />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Phone (optional)</label>
                <input type="tel" inputMode="tel" value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} placeholder="(913) 555-0100" className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowManualEntry(false)} className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 bg-gray-50">Cancel</button>
                <button onClick={startManual} disabled={!manualName.trim()} className="flex-1 py-3 rounded-xl bg-[#0a1f3d] text-white text-sm font-bold disabled:opacity-40">Start Consult</button>
              </div>
            </div>
          )}

          {!showManualEntry && (
            <>
              {localDrafts.length > 0 && (
                <>
                  <div className="flex items-center gap-3 py-1 mt-2">
                    <div className="flex-1 h-px bg-gray-200" />
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">Saved Drafts (Local)</div>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  {localDrafts.map((d: any) => (
                    <button key={d.form.contactId} onClick={() => {
                      setSelectedContact({ id: d.form.contactId, name: d.form.contactName, phone: d.form.contactPhone, email: d.form.contactEmail, address: d.form.propertyAddress, stage: d.form.pipelineStage, opportunityId: d.form.opportunityId });
                      setForm(d.form);
                    }} className="w-full bg-white rounded-2xl p-4 text-left border border-gray-200 active:bg-gray-50 shadow-sm mt-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-bold text-[#0a1f3d] text-base">{d.form.contactName}</p>
                          <p className="text-gray-500 text-sm mt-0.5">{d.form.propertyAddress || d.form.contactPhone || "No details"}</p>
                        </div>
                        <span className="text-xs bg-orange-100 text-orange-700 font-medium px-2 py-1 rounded-full mt-0.5 shrink-0 ml-2">Saved</span>
                      </div>
                    </button>
                  ))}
                </>
              )}

              <div className="flex items-center gap-3 py-1 mt-6">
                <div className="flex-1 h-px bg-gray-200" />
                <div className="flex items-center gap-1.5 text-xs text-gray-400"><Users size={12} /> Recent Contacts</div>
                <div className="flex-1 h-px bg-gray-200" />
              </div>

              {loadingContacts ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="animate-spin text-[#0a1f3d]" size={28} />
                </div>
              ) : (
                <div className="space-y-3">
                  {(searchQuery.length > 0
                    ? contacts.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone.includes(searchQuery))
                    : contacts
                  ).map((c) => (
                    <button key={c.id} onClick={() => selectContact(c)} className="w-full bg-white rounded-2xl p-4 text-left border border-gray-200 active:bg-gray-50 shadow-sm">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-bold text-[#0a1f3d] text-base">{c.name}</p>
                          <p className="text-gray-500 text-sm mt-0.5">{c.phone}</p>
                        </div>
                        <span className="text-xs bg-[#0a1f3d]/10 text-[#0a1f3d] font-medium px-2 py-1 rounded-full mt-0.5 shrink-0 ml-2">{c.stage || "Contact"}</span>
                      </div>
                    </button>
                  ))}
                  {contacts.length === 0 && !searching && (
                    <div className="text-center py-10 bg-white rounded-2xl border border-gray-200">
                      <p className="text-gray-500 text-sm">No customers found.</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-52">
      <div className="bg-[#0a1f3d] px-4 pt-10 pb-5 sticky top-0 z-20 shadow-lg">
        <div className="flex items-center gap-3 mb-1">
          <img src="https://vibe.filesafe.space/1778961049274125424/assets/7a08ba12-4d80-4131-ad78-bd01283acbf1.png" alt="Abrams Fence Co." className="h-7 object-contain" />
        </div>
        <div className="flex items-start justify-between mt-2">
          <div>
            <h2 className="text-white font-bold text-lg leading-tight">{form.contactName || "Customer"}</h2>
            {form.contactPhone && (
              <a href={`tel:${form.contactPhone}`} className="text-white/70 text-sm flex items-center gap-1 mt-0.5 active:text-white">
                <Phone size={13} /> {form.contactPhone}
              </a>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="text-xs bg-amber-400/20 text-amber-300 border border-amber-400/30 px-2.5 py-1 rounded-full font-semibold">
              {form.pipelineStage || "Estimate Booked"}
            </span>
            <button onClick={() => setSelectedContact(null)} className="text-white/40 text-xs underline">Change</button>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-2">
        {SECTIONS.map((title, idx) => (
          <div key={idx} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <button type="button" onClick={() => toggleSection(idx)} className="w-full flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-[#0a1f3d] text-white text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                <span className="font-semibold text-gray-800 text-sm">{title}</span>
              </div>
              <ChevronDown size={18} className={`text-gray-400 transition-transform ${openSection === idx ? "rotate-180" : ""}`} />
            </button>
            {openSection === idx && (
              <div className="px-4 pb-5 border-t border-gray-100">
                <div className="pt-4">
                  {idx === 0 && <PropertySection data={form} onChange={updateForm} />}
                  {idx === 1 && <MeasurementsSection data={form} onChange={updateForm} />}
                  {idx === 2 && <GatesSection data={form} onChange={updateForm} />}
                  {idx === 3 && <VisualLayoutSection data={form} onChange={updateForm} />}
                  {idx === 4 && <AddOnsSection data={form} onChange={updateForm} />}
                  {idx === 5 && <PurposeSection data={form} onChange={updateForm} />}
                  {idx === 6 && <PhotosSection data={form} onChange={updateForm} />}
                  {idx === 7 && (
                    <textarea
                      value={form.consultantNotes}
                      onChange={(e) => updateForm({ consultantNotes: e.target.value })}
                      placeholder="Internal notes..."
                      rows={5}
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 resize-none"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-2xl z-30 px-4 pt-4 pb-6">
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="text-center">
            <p className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5 font-semibold">Internal Est.</p>
            <p className="font-bold text-[#0a1f3d] font-mono text-sm">{cur(totals.internalEstimate)}</p>
          </div>
          <div className="text-center border-x border-gray-100">
            <p className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5 font-semibold">Customer Total</p>
            <p className="font-bold text-green-600 font-mono text-sm">{cur(totals.grandTotal)}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5 font-semibold">Margin</p>
            <p className="font-bold text-gray-600 font-mono text-sm">{totals.margin.toFixed(1)}%</p>
          </div>
        </div>

        {saveStatus === "success" && (
          <div className="flex items-center gap-2 text-green-600 text-xs mb-2 justify-center">
            <CheckCircle size={13} /> {saveMessage}
          </div>
        )}
        {saveStatus === "error" && (
          <div className="flex items-center gap-2 text-red-500 text-xs mb-2 justify-center">
            <AlertCircle size={13} /> {saveMessage}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button onClick={handleSaveDraft} disabled={saving} className="py-3.5 rounded-xl border-2 border-[#0a1f3d] text-[#0a1f3d] font-bold text-sm active:bg-[#0a1f3d]/5 disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save Draft
          </button>
          <button onClick={handleContinueToProposal} disabled={saving} className="py-3.5 rounded-xl bg-[#1d9e75] text-white font-bold text-sm active:bg-[#0f6e56] disabled:opacity-50 flex items-center justify-center gap-1.5 leading-tight">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {saving ? "Saving..." : "Continue to Proposal →"}
          </button>
        </div>
      </div>
    </div>
  );
};
