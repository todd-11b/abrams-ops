import React, { useState, useRef, useEffect } from "react";
import { ZoomIn, ZoomOut, TreePine, Waves, Zap, Home, StickyNote, Trash2 } from "lucide-react";
import { ConsultFormData, Obstruction } from "./consultTypes";

interface VisualLayoutSectionProps {
  data: ConsultFormData;
  onChange: (updates: Partial<ConsultFormData>) => void;
}

export const VisualLayoutSection: React.FC<VisualLayoutSectionProps> = ({ data, onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scale = 5; // 5 pixels per foot
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<"fence" | "gate" | "obstruction" | null>(null);
  const [activeHandle, setActiveHandle] = useState<"start" | "end" | "resize" | null>(null);
  const [snapPoint, setSnapPoint] = useState<{ x: number; y: number } | null>(null);
  const [showNoteModal, setShowNoteModal] = useState<string | null>(null);

  // Sync fence lines and ensure they all have positions
  useEffect(() => {
    const linesWithPositions = data.fenceLines.map((line, index) => {
      if (!line.position) {
        return {
          ...line,
          position: { x: 100, y: 100 + index * 60 },
          rotation: 0
        };
      }
      return line;
    });

    const hasMissing = data.fenceLines.some(l => !l.position);
    if (hasMissing) {
      onChange({ fenceLines: linesWithPositions });
    }
  }, [data.fenceLines.length]);

  // Sync gate instances with quantities to ensure they always appear
  useEffect(() => {
    const walkCount = data.gates.walk.qty || 0;
    const doubleCount = data.gates.double.qty || 0;

    const currentWalk = (data.gateInstances || []).filter(g => g.type === "walk");
    const currentDouble = (data.gateInstances || []).filter(g => g.type === "double");

    if (currentWalk.length === walkCount && currentDouble.length === doubleCount) return;

    let newInstances = [...(data.gateInstances || [])];

    // Sync Walk Gates
    if (currentWalk.length < walkCount) {
      for (let i = 0; i < walkCount - currentWalk.length; i++) {
        newInstances.push({
          id: crypto.randomUUID(),
          type: "walk",
          position: { x: 150, y: 150 + (newInstances.length * 30) },
          rotation: 0,
          swing: "out-right"
        });
      }
    } else if (currentWalk.length > walkCount) {
      let toRemove = currentWalk.length - walkCount;
      newInstances = newInstances.filter(g => {
        if (g.type === "walk" && toRemove > 0) {
          toRemove--;
          return false;
        }
        return true;
      });
    }

    // Sync Double Gates
    if (currentDouble.length < doubleCount) {
      for (let i = 0; i < doubleCount - currentDouble.length; i++) {
        newInstances.push({
          id: crypto.randomUUID(),
          type: "double",
          position: { x: 180, y: 150 + (newInstances.length * 30) },
          rotation: 0,
          swing: "out-right"
        });
      }
    } else if (currentDouble.length > doubleCount) {
      let toRemove = currentDouble.length - doubleCount;
      newInstances = newInstances.filter(g => {
        if (g.type === "double" && toRemove > 0) {
          toRemove--;
          return false;
        }
        return true;
      });
    }

    onChange({ gateInstances: newInstances });
  }, [data.gates.walk.qty, data.gates.double.qty]);

  const addObstruction = (type: Obstruction["type"]) => {
    const newObs: Obstruction = {
      id: crypto.randomUUID(),
      type,
      position: { x: 200, y: 200 },
      width: type === "tree" ? 40 : type === "pool" ? 120 : type === "house" ? 150 : 30,
      height: type === "tree" ? 40 : type === "pool" ? 80 : type === "house" ? 100 : 30,
      rotation: 0
    };
    onChange({ obstructions: [...(data.obstructions || []), newObs] });
  };

  const removeObstruction = (id: string) => {
    onChange({ obstructions: (data.obstructions || []).filter(o => o.id !== id) });
  };

  const removeGate = (id: string, type: "walk" | "double") => {
    const updatedInstances = (data.gateInstances || []).filter(g => g.id !== id);
    const updatedQty = Math.max(0, (type === "walk" ? data.gates.walk.qty : data.gates.double.qty) - 1);
    onChange({
      gateInstances: updatedInstances,
      gates: { ...data.gates, [type]: { ...data.gates[type], qty: updatedQty } }
    });
  };

  const getClientPos = (e: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in e && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if ('changedTouches' in e && (e as React.TouchEvent).changedTouches.length > 0) {
      return { x: (e as React.TouchEvent).changedTouches[0].clientX, y: (e as React.TouchEvent).changedTouches[0].clientY };
    }
    return { x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY };
  };

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent, id: string | null = null, type: "fence" | "gate" | "obstruction" | null = null, handle: "start" | "end" | "resize" | null = null) => {
    if ('touches' in e) e.stopPropagation();
    const { x: clientX, y: clientY } = getClientPos(e);

    if (id) {
      setActiveId(id);
      setActiveType(type);
      setActiveHandle(handle || "start");
      setIsDragging(true);
      setDragStart({ x: clientX, y: clientY });
    } else {
      setIsDragging(true);
      setDragStart({ x: clientX, y: clientY });
    }
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging) return;
    if ('touches' in e) e.preventDefault();

    const { x: clientX, y: clientY } = getClientPos(e);

    const dx = (clientX - dragStart.x) / zoom;
    const dy = (clientY - dragStart.y) / zoom;

    if (activeId) {
      setSnapPoint(null);

      if (activeType === "fence") {
        const updatedLines = data.fenceLines.map(line => {
          if (line.id === activeId) {
            const currentX = line.position?.x || 0;
            const currentY = line.position?.y || 0;

            if (activeHandle === "start") {
              const newX = currentX + dx;
              const newY = currentY + dy;

              let snappedX = newX;
              let snappedY = newY;
              const SNAP_DIST = 15;

              data.fenceLines.forEach(other => {
                if (other.id === activeId) return;
                const otherX = other.position?.x || 0;
                const otherY = other.position?.y || 0;
                const otherRot = (other.rotation || 0) * (Math.PI / 180);
                const otherLen = (other.linearFeet || 0) * 5;
                const otherEndX = otherX + Math.cos(otherRot) * otherLen;
                const otherEndY = otherY + Math.sin(otherRot) * otherLen;

                if (Math.abs(newX - otherEndX) < SNAP_DIST && Math.abs(newY - otherEndY) < SNAP_DIST) {
                  snappedX = otherEndX; snappedY = otherEndY;
                  setSnapPoint({ x: otherEndX, y: otherEndY });
                } else if (Math.abs(newX - otherX) < SNAP_DIST && Math.abs(newY - otherY) < SNAP_DIST) {
                  snappedX = otherX; snappedY = otherY;
                  setSnapPoint({ x: otherX, y: otherY });
                }
              });

              (data.obstructions || []).forEach(obs => {
                if (obs.type === "house") {
                  const ox = obs.position.x;
                  const oy = obs.position.y;
                  const ow = obs.width;
                  const oh = obs.height;
                  const corners = [
                    { x: ox, y: oy }, { x: ox + ow, y: oy },
                    { x: ox, y: oy + oh }, { x: ox + ow, y: oy + oh }
                  ];
                  corners.forEach(c => {
                    if (Math.abs(newX - c.x) < SNAP_DIST && Math.abs(newY - c.y) < SNAP_DIST) {
                      snappedX = c.x; snappedY = c.y;
                      setSnapPoint({ x: c.x, y: c.y });
                    }
                  });
                  if (snappedX === newX && snappedY === newY) {
                    if (newX >= ox && newX <= ox + ow) {
                      if (Math.abs(newY - oy) < SNAP_DIST) { snappedY = oy; setSnapPoint({ x: newX, y: oy }); }
                      else if (Math.abs(newY - (oy + oh)) < SNAP_DIST) { snappedY = oy + oh; setSnapPoint({ x: newX, y: oy + oh }); }
                    }
                    if (newY >= oy && newY <= oy + oh) {
                      if (Math.abs(newX - ox) < SNAP_DIST) { snappedX = ox; setSnapPoint({ x: ox, y: newY }); }
                      else if (Math.abs(newX - (ox + ow)) < SNAP_DIST) { snappedX = ox + ow; setSnapPoint({ x: ox + ow, y: newY }); }
                    }
                  }
                }
              });

              return { ...line, position: { x: snappedX, y: snappedY } };
            } else {
              const containerRect = containerRef.current?.getBoundingClientRect();
              if (!containerRect) return line;
              const mouseXInCanvas = (clientX - containerRect.left - offset.x) / zoom;
              const mouseYInCanvas = (clientY - containerRect.top - offset.y) / zoom;
              const angle = Math.atan2(mouseYInCanvas - currentY, mouseXInCanvas - currentX) * (180 / Math.PI);
              const snappedAngle = Math.round(angle / 15) * 15;
              let finalAngle = Math.abs(angle - snappedAngle) < 5 ? snappedAngle : angle;

              data.fenceLines.forEach(other => {
                if (other.id === activeId) return;
                const otherX = other.position?.x || 0;
                const otherY = other.position?.y || 0;
                const otherRot = (other.rotation || 0) * (Math.PI / 180);
                const otherLen = (other.linearFeet || 0) * 5;
                const otherEndX = otherX + Math.cos(otherRot) * otherLen;
                const otherEndY = otherY + Math.sin(otherRot) * otherLen;
                const angleToStart = Math.atan2(otherY - currentY, otherX - currentX) * (180 / Math.PI);
                const angleToEnd = Math.atan2(otherEndY - currentY, otherEndX - currentX) * (180 / Math.PI);
                if (Math.abs(angle - angleToStart) < 5) finalAngle = angleToStart;
                if (Math.abs(angle - angleToEnd) < 5) finalAngle = angleToEnd;
              });

              (data.obstructions || []).forEach(obs => {
                if (obs.type === "house") {
                  const corners = [
                    { x: obs.position.x, y: obs.position.y },
                    { x: obs.position.x + obs.width, y: obs.position.y },
                    { x: obs.position.x, y: obs.position.y + obs.height },
                    { x: obs.position.x + obs.width, y: obs.position.y + obs.height }
                  ];
                  corners.forEach(c => {
                    const angleToCorner = Math.atan2(c.y - currentY, c.x - currentX) * (180 / Math.PI);
                    if (Math.abs(angle - angleToCorner) < 5) finalAngle = angleToCorner;
                  });
                }
              });

              return { ...line, rotation: finalAngle };
            }
          }
          return line;
        });
        onChange({ fenceLines: updatedLines });
      } else if (activeType === "gate") {
        let updatedGates = (data.gateInstances || []).map(gate => {
          if (gate.id === activeId) {
            const currentX = gate.position?.x || 0;
            const currentY = gate.position?.y || 0;

            if (activeHandle === "start") {
              const newX = currentX + dx;
              const newY = currentY + dy;
              let snappedX = newX;
              let snappedY = newY;
              const SNAP_DIST = 15;

              data.fenceLines.forEach(line => {
                const lx = line.position?.x || 0;
                const ly = line.position?.y || 0;
                const lr = (line.rotation || 0) * (Math.PI / 180);
                const ll = (line.linearFeet || 0) * scale;
                const lex = lx + Math.cos(lr) * ll;
                const ley = ly + Math.sin(lr) * ll;
                const ddx = lex - lx;
                const ddy = ley - ly;
                const lineLenSq = ddx * ddx + ddy * ddy;
                if (lineLenSq === 0) return;
                const t = Math.max(0, Math.min(1, ((newX - lx) * ddx + (newY - ly) * ddy) / lineLenSq));
                const projX = lx + t * ddx;
                const projY = ly + t * ddy;
                const dist = Math.sqrt((newX - projX) ** 2 + (newY - projY) ** 2);
                if (dist < SNAP_DIST) {
                  snappedX = projX; snappedY = projY;
                  setSnapPoint({ x: projX, y: projY });
                  updatedGates = updatedGates.map(g =>
                    g.id === activeId ? { ...g, rotation: line.rotation || 0 } : g
                  );
                }
              });

              return { ...gate, position: { x: snappedX, y: snappedY } };
            } else {
              const containerRect = containerRef.current?.getBoundingClientRect();
              if (!containerRect) return gate;
              const mouseXInCanvas = (clientX - containerRect.left - offset.x) / zoom;
              const mouseYInCanvas = (clientY - containerRect.top - offset.y) / zoom;
              const angle = Math.atan2(mouseYInCanvas - currentY, mouseXInCanvas - currentX) * (180 / Math.PI);
              const snappedAngle = Math.round(angle / 45) * 45;
              const finalAngle = Math.abs(angle - snappedAngle) < 10 ? snappedAngle : angle;
              return { ...gate, rotation: finalAngle };
            }
          }
          return gate;
        });
        onChange({ gateInstances: updatedGates });
      } else if (activeType === "obstruction") {
        const updatedObs = (data.obstructions || []).map(obs => {
          if (obs.id === activeId) {
            if (activeHandle === "start") {
              return { ...obs, position: { x: obs.position.x + dx, y: obs.position.y + dy } };
            } else if (activeHandle === "resize") {
              return { ...obs, width: Math.max(20, obs.width + dx), height: Math.max(20, obs.height + dy) };
            } else if (activeHandle === "end") {
              const containerRect = containerRef.current?.getBoundingClientRect();
              if (!containerRect) return obs;
              const mouseXInCanvas = (clientX - containerRect.left - offset.x) / zoom;
              const mouseYInCanvas = (clientY - containerRect.top - offset.y) / zoom;
              const angle = Math.atan2(mouseYInCanvas - obs.position.y, mouseXInCanvas - obs.position.x) * (180 / Math.PI);
              return { ...obs, rotation: angle };
            }
          }
          return obs;
        });
        onChange({ obstructions: updatedObs });
      }
      setDragStart({ x: clientX, y: clientY });
    } else {
      setOffset(prev => ({
        x: prev.x + (clientX - dragStart.x),
        y: prev.y + (clientY - dragStart.y)
      }));
      setDragStart({ x: clientX, y: clientY });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setActiveId(null);
    setActiveType(null);
    setActiveHandle(null);
    setSnapPoint(null);
  };

  const updateGateSwing = (id: string, swing: any) => {
    const updated = (data.gateInstances || []).map(g => g.id === id ? { ...g, swing } : g);
    onChange({ gateInstances: updated });
  };



  return (
    <div className="space-y-3">
      {/* Toolbar — 3-row mobile layout */}
      <div className="bg-gray-50 p-2 rounded-xl border border-gray-200 space-y-2">
        {/* Row 1: Site objects */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-[#0a1f3d] px-2">+ Add:</span>
          <button onClick={() => addObstruction("house")} className="flex items-center gap-1 px-2.5 py-2 bg-white rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 active:bg-gray-100">
            <Home size={13} className="text-slate-600" /> House
          </button>
          <button onClick={() => addObstruction("tree")} className="flex items-center gap-1 px-2.5 py-2 bg-white rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 active:bg-gray-100">
            <TreePine size={13} className="text-green-600" /> Tree
          </button>
          <button onClick={() => addObstruction("pool")} className="flex items-center gap-1 px-2.5 py-2 bg-white rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 active:bg-gray-100">
            <Waves size={13} className="text-blue-500" /> Pool
          </button>
          <button onClick={() => addObstruction("utility")} className="flex items-center gap-1 px-2.5 py-2 bg-white rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 active:bg-gray-100">
            <Zap size={13} className="text-amber-500" /> Utility
          </button>
        </div>
        {/* Row 2: Gates + Zoom */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onChange({ gates: { ...data.gates, walk: { ...data.gates.walk, qty: data.gates.walk.qty + 1 } } })}
            className="flex-1 flex items-center justify-center gap-1 px-2.5 py-2 bg-green-50 rounded-lg border border-green-200 text-xs font-bold text-green-700 active:bg-green-100 min-h-[40px]"
          >
            + Walk Gate
          </button>
          <button
            onClick={() => onChange({ gates: { ...data.gates, double: { ...data.gates.double, qty: data.gates.double.qty + 1 } } })}
            className="flex-1 flex items-center justify-center gap-1 px-2.5 py-2 bg-green-50 rounded-lg border border-green-200 text-xs font-bold text-green-700 active:bg-green-100 min-h-[40px]"
          >
            + Double Gate
          </button>
          <div className="flex border border-gray-200 rounded-lg overflow-hidden bg-white shrink-0">
            <button onClick={() => setZoom(z => Math.max(0.3, z - 0.15))} className="p-2.5 active:bg-gray-100 border-r border-gray-200">
              <ZoomOut className="w-4 h-4 text-gray-600" />
            </button>
            <button onClick={() => setZoom(z => Math.min(3, z + 0.15))} className="p-2.5 active:bg-gray-100">
              <ZoomIn className="w-4 h-4 text-gray-600" />
            </button>
          </div>
          <button
            onClick={() => alert("HOW TO USE:\n1. Drag the white dot at each run's START to move it.\n2. Drag the white dot at the END to rotate the run.\n3. Dots snap together — connect runs to form a perimeter.\n4. Drag gates near a fence line — they snap onto it.\n5. Pinch or use +/− to zoom. Drag empty space to pan.")}
            className="px-3 py-2 bg-white rounded-lg border border-gray-200 text-xs font-bold text-[#0a1f3d] active:bg-gray-50 shrink-0 min-h-[40px]"
          >
            HELP
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative w-full bg-slate-100 rounded-2xl border-2 border-dashed border-gray-300 overflow-hidden cursor-crosshair"
        style={{ height: "clamp(360px, 55vw, 520px)", touchAction: "none" }}
        onMouseDown={(e) => handleMouseDown(e)}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={(e) => handleMouseDown(e)}
        onTouchMove={(e) => handleMouseMove(e)}
        onTouchEnd={() => handleMouseUp()}

      >
        {/* Grid Background */}
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: `radial-gradient(#0a1f3d 1px, transparent 1px)`,
            backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
            backgroundPosition: `${offset.x}px ${offset.y}px`
          }}
        />

        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "0 0"
          }}
        >
          {/* Snap Indicator */}
          {snapPoint && (
            <div
              className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-green-500 bg-green-500/20 animate-pulse z-0"
              style={{ left: snapPoint.x, top: snapPoint.y }}
            />
          )}

          {/* Obstructions */}
          {(data.obstructions || []).map((obs) => (
            <div
              key={obs.id}
              className={`absolute select-none group ${activeId === obs.id ? "z-50" : "z-0"}`}
              style={{
                left: obs.position.x,
                top: obs.position.y,
                width: obs.width,
                height: obs.height,
                transform: `rotate(${obs.rotation}deg)`,
                transformOrigin: "0 0"
              }}
            >
              <div
                onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, obs.id, "obstruction", "start"); }}
                onTouchStart={(e) => { e.stopPropagation(); handleMouseDown(e, obs.id, "obstruction", "start"); }}
                className={`w-full h-full rounded-md border-2 flex items-center justify-center transition-all ${
                  obs.type === "house" ? "bg-slate-200 border-slate-400" :
                  obs.type === "pool" ? "bg-blue-100 border-blue-300" :
                  obs.type === "tree" ? "bg-green-100 border-green-300 rounded-full" :
                  "bg-amber-100 border-amber-300"
                } ${activeId === obs.id ? "ring-2 ring-orange-500" : ""}`}
              >
                {obs.type === "house" && <Home size={Math.max(16, obs.width / 4)} className="text-slate-400" />}
                {obs.type === "pool" && <Waves size={Math.max(16, obs.width / 4)} className="text-blue-400" />}
                {obs.type === "tree" && <TreePine size={Math.max(16, obs.width / 2)} className="text-green-400" />}
                {obs.type === "utility" && <Zap size={Math.max(16, obs.width / 3)} className="text-amber-400" />}
              </div>

              {/* Resize Handle — always visible on mobile */}
              <div
                onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, obs.id, "obstruction", "resize"); }}
                onTouchStart={(e) => { e.stopPropagation(); handleMouseDown(e, obs.id, "obstruction", "resize"); }}
                className="absolute -bottom-2 -right-2 w-6 h-6 bg-white border border-gray-400 rounded-sm cursor-nwse-resize opacity-70 group-hover:opacity-100"
              />
              {/* Delete Button — always visible */}
              <button
                onClick={(e) => { e.stopPropagation(); removeObstruction(obs.id); }}
                className="absolute -top-3 -right-3 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center shadow-sm"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          {/* Fence Lines */}
          {data.fenceLines.map((line) => {
            const pos = line.position || { x: 100, y: 100 };
            const length = (line.linearFeet || 0) * scale;
            const rot = line.rotation || 0;
            const isSelected = activeId === line.id;
            const hasNote = !!line.crewNote;

            return (
              <div
                key={line.id}
                className={`absolute select-none ${isSelected ? "z-50" : "z-10"}`}
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: Math.max(length, 40),
                  height: 6,
                  transform: `rotate(${rot}deg)`,
                  transformOrigin: "0 50%",
                }}
              >
                {/* Line Body */}
                <div
                  className={`w-full h-full rounded-full transition-colors ${
                    isSelected ? "bg-orange-500" : "bg-[#0a1f3d]"
                  } shadow-sm border border-white/20`}
                />

                {/* Start Handle (Move) — bigger for mobile */}
                <div
                  onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, line.id, "fence", "start"); }}
                  onTouchStart={(e) => { e.stopPropagation(); handleMouseDown(e, line.id, "fence", "start"); }}
                  className={`absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 cursor-grab flex items-center justify-center ${
                    isSelected ? "bg-orange-100 border-orange-500" : "bg-white border-[#0a1f3d]"
                  } shadow-md`}
                >
                  <div className={`w-2.5 h-2.5 rounded-full ${isSelected ? "bg-orange-500" : "bg-[#0a1f3d]"}`} />
                </div>

                {/* End Handle (Rotate) — bigger for mobile */}
                <div
                  onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, line.id, "fence", "end"); }}
                  onTouchStart={(e) => { e.stopPropagation(); handleMouseDown(e, line.id, "fence", "end"); }}
                  className={`absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 cursor-crosshair flex items-center justify-center ${
                    isSelected ? "bg-orange-100 border-orange-500" : "bg-white border-[#0a1f3d]"
                  } shadow-md`}
                >
                  <div className={`w-2 h-2 rounded-full ${isSelected ? "bg-orange-500" : "bg-blue-500"}`} />
                </div>

                {/* Label & Note */}
                <div
                  className="absolute top-[-24px] left-1/2 -translate-x-1/2 flex items-center gap-1"
                  style={{ transform: `translateX(-50%) rotate(${-rot}deg)` }}
                >
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap shadow-sm border ${
                    isSelected ? "bg-orange-500 text-white border-orange-600" : "bg-white text-[#0a1f3d] border-gray-200"
                  }`}>
                    {line.label || "Run"} ({line.linearFeet}ft)
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowNoteModal(line.id); }}
                    className={`w-6 h-6 rounded-full flex items-center justify-center shadow-sm border ${
                      hasNote ? "bg-amber-400 border-amber-500 text-amber-900" : "bg-white border-gray-200 text-gray-400"
                    }`}
                  >
                    <StickyNote size={12} />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Gates */}
          {(data.gateInstances || []).map((gate) => {
            const pos = gate.position || { x: 150, y: 150 };
            const rot = gate.rotation || 0;
            const isWalk = gate.type === "walk";
            const width = isWalk ? 20 : 40; // 4ft walk, 8ft double
            const isSelected = activeId === gate.id;

            return (
              <div
                key={gate.id}
                className={`absolute select-none group ${isSelected ? "z-50" : "z-20"}`}
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: width,
                  height: 6,
                  transform: `rotate(${rot}deg)`,
                  transformOrigin: "0 50%",
                }}
              >
                {/* Gate Body */}
                <div
                  className={`w-full h-full rounded-sm border-2 transition-colors ${
                    isSelected ? "bg-orange-400 border-orange-600" : "bg-[#1d9e75] border-[#0f6e56]"
                  }`}
                />

                {/* Move Handle — big for mobile */}
                <div
                  onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, gate.id, "gate", "start"); }}
                  onTouchStart={(e) => { e.stopPropagation(); handleMouseDown(e, gate.id, "gate", "start"); }}
                  className={`absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 cursor-grab flex items-center justify-center ${
                    isSelected ? "bg-orange-100 border-orange-500" : "bg-white border-[#1d9e75]"
                  } shadow-sm`}
                >
                  <div className={`w-2 h-2 rounded-full ${isSelected ? "bg-orange-500" : "bg-[#1d9e75]"}`} />
                </div>

                {/* Swing Visualizer */}
                {gate.swing && (
                  <div className="absolute w-full h-full pointer-events-none">
                    <div
                      className="absolute border-2 border-dashed border-[#1d9e75]/40 rounded-full"
                      style={{
                        width: isWalk ? width * 2 : width,
                        height: isWalk ? width * 2 : width,
                        bottom: gate.swing.includes("out") ? "100%" : "auto",
                        top: gate.swing.includes("in") ? "100%" : "auto",
                        left: gate.swing.includes("left") ? "auto" : "100%",
                        right: gate.swing.includes("right") ? "auto" : "100%",
                        transform: gate.swing.includes("left") && gate.swing.includes("out") ? "translate(50%, 50%)" :
                                   gate.swing.includes("right") && gate.swing.includes("out") ? "translate(-50%, 50%)" :
                                   gate.swing.includes("left") && gate.swing.includes("in") ? "translate(50%, -50%)" :
                                   "translate(-50%, -50%)"
                      }}
                    />
                  </div>
                )}

                {/* Swing Controls — visible on hover or select */}
                <div
                  className={`absolute top-[-40px] left-1/2 -translate-x-1/2 flex gap-1 bg-white p-1 rounded-lg shadow-lg border border-gray-200 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                  style={{ transform: `translateX(-50%) rotate(${-rot}deg)` }}
                >
                  <button onClick={(e) => { e.stopPropagation(); updateGateSwing(gate.id, "out-left"); }} className={`px-2 py-1 text-[10px] font-bold rounded ${gate.swing === "out-left" ? "bg-[#1d9e75] text-white" : "bg-gray-100 text-gray-600"}`}>↖</button>
                  <button onClick={(e) => { e.stopPropagation(); updateGateSwing(gate.id, "out-right"); }} className={`px-2 py-1 text-[10px] font-bold rounded ${gate.swing === "out-right" ? "bg-[#1d9e75] text-white" : "bg-gray-100 text-gray-600"}`}>↗</button>
                  <button onClick={(e) => { e.stopPropagation(); updateGateSwing(gate.id, "in-left"); }} className={`px-2 py-1 text-[10px] font-bold rounded ${gate.swing === "in-left" ? "bg-[#1d9e75] text-white" : "bg-gray-100 text-gray-600"}`}>↙</button>
                  <button onClick={(e) => { e.stopPropagation(); updateGateSwing(gate.id, "in-right"); }} className={`px-2 py-1 text-[10px] font-bold rounded ${gate.swing === "in-right" ? "bg-[#1d9e75] text-white" : "bg-gray-100 text-gray-600"}`}>↘</button>
                  <div className="w-px bg-gray-200 mx-1" />
                  <button onClick={(e) => { e.stopPropagation(); removeGate(gate.id, gate.type); }} className="px-2 py-1 text-[10px] font-bold rounded bg-red-100 text-red-600">Del</button>
                </div>

                <div
                  className="absolute top-[-16px] left-1/2 -translate-x-1/2"
                  style={{ transform: `translateX(-50%) rotate(${-rot}deg)` }}
                >
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap shadow-sm border ${
                    isSelected ? "bg-orange-500 text-white border-orange-600" : "bg-white text-[#1d9e75] border-green-200"
                  }`}>
                    {isWalk ? "Walk" : "Double"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Note Modal */}
      {showNoteModal && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-[#0a1f3d] mb-3">Crew Note for {data.fenceLines.find(l => l.id === showNoteModal)?.label || "Run"}</h3>
            <textarea
              autoFocus
              value={data.fenceLines.find(l => l.id === showNoteModal)?.crewNote || ""}
              onChange={(e) => {
                const updated = data.fenceLines.map(l => l.id === showNoteModal ? { ...l, crewNote: e.target.value } : l);
                onChange({ fenceLines: updated });
              }}
              placeholder="e.g. Stop 2ft short of property line..."
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 min-h-[100px] mb-4"
            />
            <button onClick={() => setShowNoteModal(null)} className="w-full py-3 bg-[#0a1f3d] text-white font-bold rounded-xl active:bg-[#0a1f3d]/90">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
