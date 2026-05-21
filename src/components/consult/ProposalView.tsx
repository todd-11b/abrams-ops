import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Send, Users, Printer } from "lucide-react";
import { ConsultFormData, FENCE_STYLES, calcTotals } from "./consultTypes";

interface Props {
  form: ConsultFormData;
  totals: ReturnType<typeof calcTotals>;
  onBack: () => void;
  onPresent: () => void;
  onSendForReview: () => Promise<void> | void;
  onRegenerateInvoice?: () => Promise<void> | void;
  onSendToCustomer?: () => Promise<void> | void;
  onAcceptProposal?: () => Promise<void> | void;
  sending: boolean;
  sent: boolean;
  isPublic?: boolean;
}


function cur(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function ProposalDocument({ form, totals, internalView }: {
  form: ConsultFormData;
  totals: ReturnType<typeof calcTotals>;
  internalView: boolean;
}) {
  const today = new Date();
  const validThrough = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const primaryLine = form.fenceLines[0];
  const primaryStyle = primaryLine ? FENCE_STYLES[primaryLine.style] : null;
  const totalLF = form.fenceLines.reduce((s, l) => s + (l.linearFeet || 0), 0);
  const totalWalkGates = form.gates.walk.qty;
  const totalDoubleGates = form.gates.double.qty;

  const projectParts = [
    `Supply and install approximately ${totalLF} linear feet of`,
    primaryStyle ? primaryStyle.label : "fence",
    form.fenceLines.length > 1 ? `(and ${form.fenceLines.length - 1} additional fence line${form.fenceLines.length > 2 ? "s" : ""})` : "",
    totalWalkGates > 0 ? `with ${totalWalkGates} walk gate${totalWalkGates > 1 ? "s" : ""}` : "",
    totalDoubleGates > 0 ? `and ${totalDoubleGates} double gate${totalDoubleGates > 1 ? "s" : ""}` : "",
    "at",
    form.propertyAddress || "the property address on file",
    ".",
    form.addOns.demo.enabled ? `Includes removal and haul-away of approximately ${form.addOns.demo.lf} LF of existing fence.` : "",
    form.purposes.length > 0 ? `Project purpose: ${form.purposes.join(", ")}.` : "",
  ].filter(Boolean).join(" ").replace(/\s+/g, " ");

  const specRows: [string, string][] = [
    ["Fence Style", form.fenceLines.map((l) => FENCE_STYLES[l.style]?.label ?? l.style).join(", ") || "—"],
    ["Total Linear Feet", totalLF > 0 ? `${totalLF} LF` : "—"],
    ["Post Type", "SteelCore™ No-Dig Steel Posts"],
    ["Post Spacing", primaryStyle ? `${primaryStyle.spacingFt} ft on center` : "8 ft on center"],
    ["Rails", primaryStyle?.category === "Chain Link" ? "N/A (chain link)" : "3-rail construction"],
    ["Walk Gates", totalWalkGates > 0 ? `${totalWalkGates} (single swing)` : "None"],
    ["Double Gates", totalDoubleGates > 0 ? `${totalDoubleGates}` : "None"],
    ["Finish", primaryStyle?.category === "Wood" ? "Natural — staining available separately" : primaryStyle?.category === "Vinyl" ? "Factory finish, no painting needed" : "Powder-coated black"],
    ["Demolition", form.addOns.demo.enabled ? `Remove & haul away ${form.addOns.demo.lf} LF existing fence` : "Not included"],
  ];

  const includedItems = [
    "Professional grade materials",
    "SteelCore™ no-dig post system",
    "Clean site — no concrete, no mess",
    "Same-day installation in most cases",
    "All labor and hardware",
    "Debris removed from property",
    "Final walkthrough with homeowner",
    "Warranty documentation provided",
  ];

  return (
    <div id="proposal-document" style={{ fontFamily: "system-ui, -apple-system, sans-serif", color: "#0a1f3d" }} className="bg-white max-w-2xl mx-auto">
      {/* Header */}
      <div style={{ background: "#0a1f3d", padding: "28px 32px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <img src="https://vibe.filesafe.space/1778961049274125424/assets/7a08ba12-4d80-4131-ad78-bd01283acbf1.png" alt="Abrams Fence Co." style={{ height: 36, objectFit: "contain", marginBottom: 8 }} />
            <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, margin: 0 }}>Faster. Cleaner. Stronger.</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ color: "white", fontWeight: 700, fontSize: 14, margin: "0 0 4px" }}>{form.proposalId}</p>
            <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, margin: "0 0 2px" }}>Issued: {fmt(today)}</p>
            <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, margin: 0 }}>Valid through: {fmt(validThrough)}</p>
          </div>
        </div>
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.15)" }}>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, margin: 0, letterSpacing: "0.08em" }}>
            LICENSE #KC-2024-FNC-0847 &nbsp;•&nbsp; FULLY INSURED &nbsp;•&nbsp; (816) 555-0180
          </p>
        </div>
      </div>

      <div style={{ padding: "20px 32px", background: "#f8faff", borderBottom: "1px solid #e5e9ef" }}>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#5f6a7d", margin: "0 0 8px", textTransform: "uppercase" }}>Prepared for</p>
        <p style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>{form.contactName || "—"}</p>
        {form.propertyAddress && <p style={{ fontSize: 13, color: "#5f6a7d", margin: "0 0 2px" }}>{form.propertyAddress}</p>}
        {form.contactPhone && <p style={{ fontSize: 13, color: "#5f6a7d", margin: "0 0 2px" }}>{form.contactPhone}</p>}
        {form.contactEmail && <p style={{ fontSize: 13, color: "#5f6a7d", margin: 0 }}>{form.contactEmail}</p>}
      </div>

      <div style={{ padding: "20px 32px", borderBottom: "1px solid #e5e9ef" }}>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#5f6a7d", margin: "0 0 8px", textTransform: "uppercase" }}>Project Summary</p>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: "#0a1f3d", margin: 0 }}>{projectParts}</p>
        {form.hoaApproval === "Yes" && (
          <p style={{ fontSize: 12, color: "#b45309", marginTop: 8 }}>⚠ HOA approval required — customer to confirm prior to install scheduling.</p>
        )}
      </div>

      <div style={{ padding: "20px 32px", borderBottom: "1px solid #e5e9ef" }}>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#5f6a7d", margin: "0 0 12px", textTransform: "uppercase" }}>What We're Building</p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <tbody>
            {specRows.map(([label, value]) => (
              <tr key={label} style={{ borderBottom: "1px solid #f0f2f5" }}>
                <td style={{ padding: "8px 0", color: "#5f6a7d", width: "40%", fontWeight: 500 }}>{label}</td>
                <td style={{ padding: "8px 0", fontWeight: 600 }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: "20px 32px", borderBottom: "1px solid #e5e9ef", background: "#fcfdfe" }}>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#5f6a7d", margin: "0 0 12px", textTransform: "uppercase" }}>Visual Yard Layout</p>
        <div style={{ width: "100%", height: 240, background: "#f1f5f9", borderRadius: 12, border: "1px solid #e2e8f0", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(#0a1f3d 1px, transparent 1px)", backgroundSize: "20px 20px", opacity: 0.1 }} />
          <div style={{ position: "absolute", inset: 0, transform: "scale(0.8)", transformOrigin: "center" }}>
            {(form.obstructions || []).map((obs) => (
              <div key={obs.id} style={{ position: "absolute", left: `${obs.position.x}px`, top: `${obs.position.y}px`, width: obs.width, height: obs.height, background: obs.type === "house" ? "#e2e8f0" : obs.type === "pool" ? "#dbeafe" : obs.type === "tree" ? "#dcfce7" : "#fef3c7", border: `1px solid ${obs.type === "house" ? "#94a3b8" : obs.type === "pool" ? "#60a5fa" : obs.type === "tree" ? "#4ade80" : "#fbbf24"}`, borderRadius: obs.type === "tree" ? "50%" : "4px", transform: `rotate(${obs.rotation}deg)`, transformOrigin: "0 0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: obs.type === "house" ? "#64748b" : obs.type === "pool" ? "#3b82f6" : obs.type === "tree" ? "#16a34a" : "#d97706", opacity: 0.6 }}>
                {obs.type.toUpperCase()}
              </div>
            ))}
            {form.fenceLines.map((line) => {
              const pos = line.position || { x: 100, y: 100 };
              const length = (line.linearFeet || 0) * 3;
              const rot = line.rotation || 0;
              return (
                <div key={line.id} style={{ position: "absolute", left: `${pos.x}px`, top: `${pos.y}px`, width: length, height: 4, background: "#0a1f3d", borderRadius: 2, transform: `rotate(${rot}deg)`, transformOrigin: "0 50%" }}>
                  <span style={{ position: "absolute", top: -14, left: "50%", transform: `translateX(-50%) rotate(${-rot}deg)`, fontSize: 9, fontWeight: 700, whiteSpace: "nowrap", color: "#0a1f3d", background: "rgba(255,255,255,0.8)", padding: "0 4px", borderRadius: 4 }}>
                    {line.label || "Run"} ({line.linearFeet}ft)
                  </span>
                </div>
              );
            })}
            {(form.gateInstances || []).map((gate) => {
              const pos = gate.position || { x: 150, y: 150 };
              const rot = gate.rotation || 0;
              const isWalk = gate.type === "walk";
              return (
                <div key={gate.id} style={{ position: "absolute", left: `${pos.x}px`, top: `${pos.y}px`, width: isWalk ? 12 : 21, height: 4, background: "#1d9e75", borderRadius: 1, transform: `rotate(${rot}deg)`, transformOrigin: "0 50%", border: "1px solid #0f6e56" }}>
                  {gate.swing && (
                    <div style={{ position: "absolute", width: "100%", height: "100%", pointerEvents: "none" }}>
                      <div style={{ position: "absolute", border: "1px dashed rgba(29, 158, 117, 0.4)", borderRadius: "50%", width: 16, height: 16, bottom: gate.swing.includes("out") ? "100%" : "auto", top: gate.swing.includes("in") ? "100%" : "auto", left: gate.swing.includes("left") ? "auto" : "100%", right: gate.swing.includes("right") ? "auto" : "100%" }} />
                    </div>
                  )}
                  <span style={{ position: "absolute", top: -12, left: "50%", transform: `translateX(-50%) rotate(${-rot}deg)`, fontSize: 7, fontWeight: 800, whiteSpace: "nowrap", color: "#1d9e75", background: "rgba(255,255,255,0.9)", padding: "0 2px", borderRadius: 2 }}>
                    {isWalk ? "Walk" : "Double"}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ position: "absolute", bottom: 8, right: 12, fontSize: 9, color: "#64748b", fontStyle: "italic" }}>
            Representative layout — not to scale
          </div>
        </div>
      </div>

      {form.fenceLines.some(l => l.crewNote) && (
        <div style={{ padding: "20px 32px", borderBottom: "1px solid #e5e9ef", background: "#fffbeb" }}>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#92400e", margin: "0 0 12px", textTransform: "uppercase" }}>Crew Installation Notes</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {form.fenceLines.filter(l => l.crewNote).map((line, i) => (
              <div key={i} style={{ fontSize: 13, color: "#92400e" }}>
                <strong style={{ textDecoration: "underline" }}>{line.label || `Run ${i+1}`}</strong>: {line.crewNote}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: "24px 32px", borderBottom: "1px solid #e5e9ef" }}>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#5f6a7d", margin: "0 0 16px", textTransform: "uppercase" }}>Your Investment</p>
        <div style={{ marginBottom: 16 }}>
          {totals.lineBreakdown.map((lb, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: "1px solid #f0f2f5" }}>
              <span><strong style={{ color: "#0a1f3d" }}>{lb.runName}</strong>: {lb.label} — {lb.lf} LF ({lb.sections} sections)</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{cur(lb.lineTotal)}</span>
            </div>
          ))}
          {form.gates.walk.qty > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: "1px solid #f0f2f5" }}>
              <span>Walk Gate ×{form.gates.walk.qty}</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{cur(totals.walkGateTotal)}</span>
            </div>
          )}
          {form.gates.double.qty > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: "1px solid #f0f2f5" }}>
              <span>Double Gate ×{form.gates.double.qty}</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{cur(totals.doubleGateTotal)}</span>
            </div>
          )}
          {form.addOns.demo.enabled && totals.demoTotal > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: "1px solid #f0f2f5" }}>
              <span>Demo / Haul-Away — {form.addOns.demo.lf} LF</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{cur(totals.demoTotal)}</span>
            </div>
          )}
          {form.addOns.stain.enabled && totals.stainTotal > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: "1px solid #f0f2f5" }}>
              <span>Staining — {form.addOns.stain.sf} SF</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{cur(totals.stainTotal)}</span>
            </div>
          )}
          {form.addOns.poolLatch.enabled && totals.poolLatchTotal > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: "1px solid #f0f2f5" }}>
              <span>Magna / Pool Latch Upgrade ×{form.addOns.poolLatch.qty}</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{cur(totals.poolLatchTotal)}</span>
            </div>
          )}
        </div>

        <div style={{ background: "#0a1f3d", borderRadius: 12, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ color: "rgba(255,255,255,0.8)", fontWeight: 600, fontSize: 14 }}>Total Investment</span>
          <span style={{ color: "white", fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{cur(totals.grandTotal)}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: "#f8faff", borderRadius: 10, padding: "12px 16px", border: "1px solid #e5e9ef" }}>
            <p style={{ fontSize: 10, color: "#5f6a7d", margin: "0 0 4px", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase" }}>Due at Start</p>
            <p style={{ fontSize: 18, fontWeight: 800, margin: 0, fontVariantNumeric: "tabular-nums" }}>{cur(totals.deposit)}</p>
            <p style={{ fontSize: 11, color: "#5f6a7d", margin: "2px 0 0" }}>50% deposit</p>
          </div>
          <div style={{ background: "#f8faff", borderRadius: 10, padding: "12px 16px", border: "1px solid #e5e9ef" }}>
            <p style={{ fontSize: 10, color: "#5f6a7d", margin: "0 0 4px", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase" }}>Due at Completion</p>
            <p style={{ fontSize: 18, fontWeight: 800, margin: 0, fontVariantNumeric: "tabular-nums" }}>{cur(totals.balance)}</p>
            <p style={{ fontSize: 11, color: "#5f6a7d", margin: "2px 0 0" }}>balance on finish day</p>
          </div>
        </div>

        {internalView && (
          <div style={{ marginTop: 20, padding: 16, background: "#fffbeb", borderRadius: 10, border: "1px solid #fbbf24" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#92400e", margin: "0 0 10px", letterSpacing: "0.06em", textTransform: "uppercase" }}>🔒 Internal Only — Not Visible to Customer</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              {([["Material Cost", cur(totals.materialCostTotal)], ["Internal Est.", cur(totals.internalEstimate)], ["Gross Margin", `${totals.margin.toFixed(1)}%`]] as [string, string][]).map(([label, val]) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <p style={{ fontSize: 10, color: "#92400e", margin: "0 0 2px" }}>{label}</p>
                  <p style={{ fontSize: 16, fontWeight: 800, margin: 0, fontVariantNumeric: "tabular-nums", color: "#78350f" }}>{val}</p>
                </div>
              ))}
            </div>
            <div style={{ borderTop: "1px solid #fde68a", paddingTop: 10 }}>
              <p style={{ fontSize: 11, color: "#92400e", margin: "0 0 6px", fontWeight: 600 }}>Per-Section Breakdown</p>
              {totals.lineBreakdown.map((lb, i) => (
                <div key={i} style={{ fontSize: 11, color: "#92400e", display: "flex", justifyContent: "space-between", padding: "3px 0", flexWrap: "wrap", gap: 4 }}>
                  <span>{lb.label} ({lb.sections} sec)</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>sell {cur(lb.pricePerSection)}/sec · mat {cur(lb.materialCostPerSection)}/sec · {lb.pricePerSection > 0 ? ((lb.pricePerSection - lb.materialCostPerSection) / lb.pricePerSection * 100).toFixed(1) : "—"}%</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #fde68a", marginTop: 10, paddingTop: 10 }}>
                <p style={{ fontSize: 11, color: "#92400e", margin: "0 0 6px", fontWeight: 600 }}>Material List (Quantities)</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
                  {totals.materialList.map((m: any, i: number) => (
                    <div key={i} style={{ fontSize: 11, color: "#92400e", display: "flex", justifyContent: "space-between" }}>
                      <span>{m.label}</span>
                      <span style={{ fontWeight: 700 }}>{m.qty} {m.unit}</span>
                    </div>
                  ))}
                  {form.gates.walk.qty > 0 && <div style={{ fontSize: 11, color: "#92400e", display: "flex", justifyContent: "space-between" }}><span>Walk Gate Kits</span><span style={{ fontWeight: 700 }}>{form.gates.walk.qty} pcs</span></div>}
                  {form.gates.double.qty > 0 && <div style={{ fontSize: 11, color: "#92400e", display: "flex", justifyContent: "space-between" }}><span>Double Gate Kits</span><span style={{ fontWeight: 700 }}>{form.gates.double.qty} pcs</span></div>}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#92400e", display: "flex", justifyContent: "space-between", padding: "6px 0 0", borderTop: "1px solid #fde68a", marginTop: 6 }}>
                <span>Labor Benchmark ({totals.totalSections} sections × 0.47 S/H × $25)</span>
                <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{cur(totals.laborBenchmark)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "20px 32px", borderBottom: "1px solid #e5e9ef" }}>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#5f6a7d", margin: "0 0 12px", textTransform: "uppercase" }}>What's Included</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
          {includedItems.map((item) => (
            <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13 }}>
              <span style={{ color: "#1d9e75", fontWeight: 700, flexShrink: 0 }}>✓</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 32px", borderBottom: "1px solid #e5e9ef", background: "#f8faff" }}>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#5f6a7d", margin: "0 0 12px", textTransform: "uppercase" }}>Warranty</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: "white", borderRadius: 10, padding: "12px 16px", border: "1px solid #e5e9ef" }}>
            <p style={{ fontSize: 13, fontWeight: 700, margin: "0 0 4px" }}>Lifetime — SteelCore™</p>
            <p style={{ fontSize: 12, color: "#5f6a7d", margin: 0 }}>Post system against structural failure</p>
          </div>
          <div style={{ background: "white", borderRadius: 10, padding: "12px 16px", border: "1px solid #e5e9ef" }}>
            <p style={{ fontSize: 13, fontWeight: 700, margin: "0 0 4px" }}>1-Year — Workmanship</p>
            <p style={{ fontSize: 12, color: "#5f6a7d", margin: 0 }}>All labor, hardware, and installation</p>
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 32px", textAlign: "center" }}>
        {form.invoiceLink ? (
          <a
            href={form.invoiceLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "block", textDecoration: "none", background: "#1d9e75", borderRadius: 12, padding: "18px 24px" }}
          >
            <p style={{ color: "white", fontWeight: 800, fontSize: 17, margin: "0 0 4px" }}>Accept & Pay {cur(totals.deposit)} Deposit</p>
            <p style={{ color: "rgba(255,255,255,0.75)", fontSize: 12, margin: 0 }}>Balance of {cur(totals.balance)} due on completion day</p>
          </a>
        ) : (
          <div style={{ background: "#1d9e75", borderRadius: 12, padding: "18px 24px" }}>
            <p style={{ color: "white", fontWeight: 800, fontSize: 17, margin: "0 0 4px" }}>Accept proposal and pay {cur(totals.deposit)} deposit</p>
            <p style={{ color: "rgba(255,255,255,0.75)", fontSize: 12, margin: 0 }}>Balance of {cur(totals.balance)} due on completion day</p>
          </div>
        )}
      </div>

      <div style={{ padding: "0 32px 28px", borderTop: "1px solid #e5e9ef" }}>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#5f6a7d", margin: "16px 0 8px", textTransform: "uppercase" }}>Terms & Conditions</p>
        <p style={{ fontSize: 11, color: "#6b7a90", lineHeight: 1.7, margin: 0 }}>This proposal is valid for 14 days from the issue date. Pricing is based on site conditions observed during the free consultation and may be adjusted if material conditions differ significantly from those noted. A 50% deposit is required to schedule installation. The remaining balance is due upon completion. Abrams Fence Co. is not responsible for underground utilities not marked by homeowner prior to install. Customer is responsible for obtaining any required HOA approval before scheduling. Cancellations within 48 hours of scheduled install may forfeit the deposit. All work is performed in accordance with local building codes.</p>
      </div>
    </div>
  );
}

export const ProposalView = ({ form, totals, onBack, onPresent, onSendForReview, onSendToCustomer, onAcceptProposal, sending, sent, isPublic = false }: Props) => {

  const [internalView, setInternalView] = useState(false);
  const [copied, setCopied] = useState(false);
  const [proposalSent, setProposalSent] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(form.proposalStatus === "Accepted");

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f4f6f9" }}>
      {!isPublic && (
        <div style={{ background: "#0a1f3d", padding: "16px 20px" }} className="flex items-center justify-between sticky top-0 z-20 no-print">
          <button onClick={onBack} className="flex items-center gap-2 text-white/70 text-sm font-medium active:text-white">
            <ArrowLeft size={16} /> Edit Consult
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: internalView ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.1)", border: `1px solid ${internalView ? "rgba(251,191,36,0.4)" : "rgba(255,255,255,0.2)"}`, borderRadius: 99, padding: "4px 6px 4px 12px" }}>
            <span style={{ color: internalView ? "#fbbf24" : "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600 }}>{internalView ? "Internal View" : "Customer View"}</span>
            <button onClick={() => setInternalView((v) => !v)} style={{ background: internalView ? "#fbbf24" : "rgba(255,255,255,0.15)", borderRadius: 99, padding: "4px 8px", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: internalView ? "#78350f" : "white", fontSize: 11, fontWeight: 700 }}>
              {internalView ? <EyeOff size={12} /> : <Eye size={12} />}
              {internalView ? "Hide" : "Show"}
            </button>
          </div>
          <button onClick={() => window.print()} className="text-white/60 active:text-white" title="Print / Save PDF">
            <Printer size={18} />
          </button>
        </div>
      )}


      <div className="no-print px-5 py-3 flex items-center justify-between" style={{ background: "#f4f6f9" }}>
        <p style={{ fontSize: 11, color: "#5f6a7d", margin: 0 }}><span style={{ fontWeight: 700, color: "#0a1f3d" }}>{form.proposalId}</span>{" · "}{form.contactName || "Customer"}</p>
        <span style={{ fontSize: 10, fontWeight: 700, background: "#e0f2eb", color: "#1d9e75", borderRadius: 99, padding: "3px 10px", letterSpacing: "0.06em" }}>{form.proposalStatus}</span>
      </div>

      <div className="flex-1 px-4 pb-44">
        <div style={{ borderRadius: 12, overflow: "hidden", boxShadow: "0 4px 24px rgba(10,31,61,0.10)" }}>
          <ProposalDocument form={form} totals={totals} internalView={internalView} />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 no-print" style={{ background: "white", borderTop: "1px solid #e5e9ef", padding: "16px 20px 24px", boxShadow: "0 -4px 24px rgba(10,31,61,0.08)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 9, color: "#5f6a7d", margin: "0 0 2px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Total</p>
            <p style={{ fontSize: 16, fontWeight: 800, margin: 0, fontVariantNumeric: "tabular-nums", color: "#0a1f3d" }}>{cur(totals.grandTotal)}</p>
          </div>
          <div style={{ textAlign: "center", borderLeft: "1px solid #e5e9ef", borderRight: "1px solid #e5e9ef" }}>
            <p style={{ fontSize: 9, color: "#5f6a7d", margin: "0 0 2px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Deposit</p>
            <p style={{ fontSize: 16, fontWeight: 800, margin: 0, fontVariantNumeric: "tabular-nums", color: "#1d9e75" }}>{cur(totals.deposit)}</p>
          </div>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 9, color: "#5f6a7d", margin: "0 0 2px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Margin</p>
            <p style={{ fontSize: 16, fontWeight: 800, margin: 0, fontVariantNumeric: "tabular-nums", color: "#5f6a7d" }}>{totals.margin.toFixed(1)}%</p>
          </div>
        </div>

        {sent && (
          <div style={{ background: "#e0f2eb", borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#1d9e75", fontSize: 18 }}>✓</span>
            <p style={{ fontSize: 13, color: "#0f6e56", fontWeight: 600, margin: 0 }}>Proposal saved and ready to send.</p>
          </div>
        )}

        {!isPublic && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <button onClick={onPresent} style={{ background: "#0a1f3d", color: "white", border: "none", borderRadius: 12, padding: "16px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 52 }}>
                <Users size={16} /> Present to Customer
              </button>
              <button onClick={async () => { if (!sent) { await onSendForReview?.(); } else if (!proposalSent) { try { await onSendToCustomer?.(); setProposalSent(true); } catch (e) { console.error(e); } } }} disabled={sending || (sent && proposalSent)} style={{ background: (sent && proposalSent) ? "#e0f2eb" : "#1d9e75", color: (sent && proposalSent) ? "#1d9e75" : "white", border: "none", borderRadius: 12, padding: "16px 12px", fontSize: 13, fontWeight: 700, cursor: sending || (sent && proposalSent) ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: sending ? 0.7 : 1, minHeight: 52 }}>
                <Send size={16} />
                {sending ? "Saving..." : (!sent ? "Save Proposal" : (!proposalSent ? "Send to Customer" : "Sent ✓"))}
              </button>
            </div>
            {form.proposalLink && (
              <button onClick={() => { navigator.clipboard.writeText(form.proposalLink || ""); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ background: "white", color: "#0a1f3d", border: "1px solid rgba(10,31,61,0.2)", borderRadius: 12, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 44 }}>
                {copied ? "Copied!" : "Copy Proposal Link"}
              </button>
            )}
            {/* Phase 3 invoice actions disabled during proposal-first MVP
            {form.invoiceId && onRegenerateInvoice && !sent && form.proposalStatus !== "Ready" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <button onClick={onSendForReview} disabled={sending} style={{ background: "white", color: "#0a1f3d", border: "1px solid rgba(10,31,61,0.2)", borderRadius: 12, padding: "12px", fontSize: 13, fontWeight: 700, cursor: sending ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 44 }}>
                  Resend Invoice
                </button>
                <button onClick={onRegenerateInvoice} disabled={sending} style={{ background: "white", color: "#1d9e75", border: "1px solid rgba(29,158,117,0.3)", borderRadius: 12, padding: "12px", fontSize: 13, fontWeight: 700, cursor: sending ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 44 }}>
                  Regenerate Link
                </button>
              </div>
            )}
            */}
          </div>
        )}
        {accepted && isPublic && (
          <div style={{ background: "#e0f2eb", borderRadius: 10, padding: "16px", marginBottom: 16, textAlign: "center" }}>
            <p style={{ fontSize: 14, color: "#0f6e56", fontWeight: 600, margin: 0 }}>
              Thanks! We've received your acceptance and a team member will contact you shortly to finalize scheduling and deposit details.
            </p>
          </div>
        )}

        {isPublic && !form.proposalStatus.includes("Paid") && (
          form.invoiceLink ? (
            <a
              href={form.invoiceLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{ width: "100%", textDecoration: "none", background: "#1d9e75", color: "white", border: "none", borderRadius: 12, padding: "18px 12px", fontSize: 15, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 60 }}
            >
              Accept Proposal & Pay Deposit
            </a>
          ) : accepted ? (
            <div style={{ width: "100%", background: "#e0f2eb", color: "#1d9e75", borderRadius: 12, padding: "18px 12px", fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 60 }}>
              Proposal Accepted ✓
            </div>
          ) : (
            <button
              onClick={async () => {
                if (onAcceptProposal) {
                  setAccepting(true);
                  try {
                    await onAcceptProposal();
                    setAccepted(true);
                  } catch (e) {
                    console.error(e);
                  } finally {
                    setAccepting(false);
                  }
                } else {
                  onPresent();
                }
              }}
              disabled={accepting}
              style={{ width: "100%", background: "#1d9e75", color: "white", border: "none", borderRadius: 12, padding: "18px 12px", fontSize: 15, fontWeight: 800, cursor: accepting ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 60, opacity: accepting ? 0.7 : 1 }}
            >
              {accepting ? "Accepting..." : "Accept Proposal & Schedule Install"}
            </button>
          )
        )}

      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; padding: 0; }
          #proposal-document { max-width: 100% !important; }
        }
      `}</style>
    </div>
  );
};
