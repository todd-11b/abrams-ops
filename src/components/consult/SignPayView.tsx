import { useState, useRef } from "react";
import { ArrowLeft, Loader2, CheckCircle } from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import { ConsultFormData, calcTotals } from "./consultTypes";

interface Props {
  form: ConsultFormData;
  onBack: () => void;
  proposalId: string;
}

function cur(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export const SignPayView = ({ form, onBack, proposalId }: Props) => {
  const totals = calcTotals(form);
  const sigPad = useRef<SignatureCanvas>(null);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSign = async () => {
    if (sigPad.current?.isEmpty()) {
      setError("Please provide a signature before proceeding.");
      return;
    }
    setProcessing(true);
    setError(null);

    try {
      const totalLf = form.fenceLines.reduce((sum, l) => sum + (l.linearFeet || 0), 0);
      const resp = await fetch('/api/proposal/create-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: form.contactId,
          proposal_opportunity_id: form.opportunityId || null,
          proposal_display_id: proposalId,
          deposit_due: totals.deposit,
          fence_spec: {
            fence_lines: form.fenceLines,
            gates: form.gateInstances,
            addons: [
              ...(form.addOns.demo.enabled ? [{ type: 'demo', ...form.addOns.demo }] : []),
              ...(form.addOns.stain.enabled ? [{ type: 'stain', ...form.addOns.stain }] : []),
              ...(form.addOns.poolLatch.enabled ? [{ type: 'poolLatch', ...form.addOns.poolLatch }] : []),
            ],
            total_sections: totals.totalSections,
            total_lf: totalLf,
            proposal_total: totals.grandTotal,
          },
        }),
      });

      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        console.error('[SignPayView] create-job failed:', resp.status, t);
        setError("We couldn't record your signature. Please try again or call us.");
        return;
      }

      setSuccess(true);
    } catch (err) {
      console.error('[SignPayView] create-job network failure:', err);
      setError("Network error. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  if (success) {
    const first = form.contactName ? form.contactName.split(" ")[0] : "there";
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: "#f4f6f9" }}>
        <div style={{ textAlign: "center", maxWidth: 400, width: "100%" }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#e0f2eb", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <CheckCircle size={36} color="#1d9e75" />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0a1f3d", margin: "0 0 12px" }}>Proposal Signed!</h2>
          <p style={{ fontSize: 15, color: "#5f6a7d", lineHeight: 1.6, margin: "0 0 24px" }}>
            Thanks, {first}! You'll receive your deposit invoice shortly via text and email. Your project moves to production as soon as the deposit clears.
          </p>
          <div style={{ background: "white", borderRadius: 12, padding: "16px 20px", border: "1px solid #e5e9ef", marginBottom: 24 }}>
            {([
              ["Proposal", proposalId],
              ["Total Investment", cur(totals.grandTotal)],
              ["Deposit Due", cur(totals.deposit)],
              ["Balance on Finish", cur(totals.balance)],
            ] as [string, string][]).map(([label, val]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: "#5f6a7d" }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#0a1f3d", fontVariantNumeric: "tabular-nums" }}>{val}</span>
              </div>
            ))}
          </div>
          <button
            onClick={onBack}
            style={{ background: "#0a1f3d", color: "white", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}
          >
            Back to Proposal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f4f6f9" }}>
      <div style={{ background: "#0a1f3d", padding: "16px 20px" }} className="flex items-center gap-3">
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", padding: 0 }}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <p style={{ color: "white", fontWeight: 700, fontSize: 15, margin: 0 }}>Sign Proposal</p>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, margin: 0 }}>{proposalId}</p>
        </div>
      </div>

      <div className="flex-1 px-5 py-6" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ textAlign: "center", paddingBottom: 8 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0a1f3d", margin: "0 0 8px" }}>
            Finalize your project
          </h1>
          <p style={{ fontSize: 14, color: "#5f6a7d", margin: 0 }}>
            Review your investment, then sign to lock it in. Your deposit invoice will follow.
          </p>
        </div>

        {/* Investment recap */}
        <div style={{ background: "white", borderRadius: 14, border: "1px solid #e5e9ef", overflow: "hidden" }}>
          <div style={{ background: "#0a1f3d", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600 }}>Total Investment</span>
            <span style={{ color: "white", fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{cur(totals.grandTotal)}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <div style={{ padding: "16px 20px", borderRight: "1px solid #e5e9ef" }}>
              <p style={{ fontSize: 10, color: "#5f6a7d", margin: "0 0 4px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Deposit Due</p>
              <p style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "#1d9e75", fontVariantNumeric: "tabular-nums" }}>{cur(totals.deposit)}</p>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <p style={{ fontSize: 10, color: "#5f6a7d", margin: "0 0 4px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Balance on Finish</p>
              <p style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "#0a1f3d", fontVariantNumeric: "tabular-nums" }}>{cur(totals.balance)}</p>
            </div>
          </div>
        </div>

        {/* Signature */}
        <div style={{ background: "white", borderRadius: 14, border: "1px solid #e5e9ef", padding: "20px" }}>
          <div className="flex justify-between items-center mb-3">
            <p style={{ fontSize: 12, fontWeight: 700, color: "#5f6a7d", margin: 0, letterSpacing: "0.08em", textTransform: "uppercase" }}>Customer Signature</p>
            <button
              onClick={() => sigPad.current?.clear()}
              style={{ fontSize: 12, color: "#1d9e75", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}
            >
              Clear
            </button>
          </div>
          <div style={{ borderRadius: 10, background: "#f8faff", border: "1px solid #e5e9ef", overflow: "hidden" }}>
            <SignatureCanvas
              ref={sigPad}
              penColor="#0a1f3d"
              canvasProps={{ className: "w-full h-32 cursor-crosshair" }}
            />
          </div>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", color: "#ef4444", padding: "12px", borderRadius: 8, fontSize: 13, fontWeight: 500, textAlign: "center" }}>
            {error}
          </div>
        )}

        <button
          onClick={handleSign}
          disabled={processing}
          style={{
            width: "100%", background: "#1d9e75", color: "white", border: "none", borderRadius: 14,
            padding: "20px 16px", fontSize: 15, fontWeight: 800, cursor: processing ? "default" : "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4, opacity: processing ? 0.7 : 1,
            marginTop: 8
          }}
        >
          {processing
            ? <Loader2 size={20} className="animate-spin" />
            : <>
                <span>Sign Proposal</span>
                <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>Your deposit invoice will follow</span>
              </>
          }
        </button>
      </div>
    </div>
  );
};
