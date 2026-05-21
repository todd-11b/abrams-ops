import { useState } from "react";

const CORRECT_PIN = "8633";

interface PinGateProps {
  onUnlock: () => void;
}

export const PinGate = ({ onUnlock }: PinGateProps) => {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const handleDigit = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError(false);
    if (next.length === 4) {
      if (next === CORRECT_PIN) {
        onUnlock();
      } else {
        setShake(true);
        setError(true);
        setTimeout(() => {
          setPin("");
          setShake(false);
        }, 600);
      }
    }
  };

  const handleDelete = () => {
    setPin((p) => p.slice(0, -1));
    setError(false);
  };

  const dots = Array.from({ length: 4 }, (_, i) => i < pin.length);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0a1f3d] px-6">
      <img
        src="https://vibe.filesafe.space/1778961049274125424/assets/7a08ba12-4d80-4131-ad78-bd01283acbf1.png"
        alt="Abrams Fence Co."
        className="h-14 mb-8 object-contain"
      />
      <p className="text-white/60 text-sm font-sans mb-8 tracking-widest uppercase">Internal Tool — Enter PIN</p>

      {/* Dots */}
      <div className={`flex gap-4 mb-10 ${shake ? "animate-[wiggle_0.4s_ease-in-out]" : ""}`}>
        {dots.map((filled, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
              filled
                ? error
                  ? "bg-red-400 border-red-400"
                  : "bg-white border-white"
                : "border-white/30 bg-transparent"
            }`}
          />
        ))}
      </div>

      {error && <p className="text-red-400 text-sm mb-6">Incorrect PIN. Try again.</p>}

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-4 w-full max-w-[260px]">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((key, idx) => {
          if (key === "") return <div key={idx} />;
          return (
            <button
              key={idx}
              onClick={() => (key === "⌫" ? handleDelete() : handleDigit(key))}
              className="h-16 rounded-2xl bg-white/10 text-white text-xl font-semibold active:bg-white/25 transition-colors select-none"
            >
              {key}
            </button>
          );
        })}
      </div>
    </div>
  );
};
