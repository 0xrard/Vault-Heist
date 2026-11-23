import { useId } from "react";

// SVG vault door (Batch 2 #1): a pure presentation layer.
// variant "sealed" = closed door + laser seal (stats encrypted / not yet
// revealed). variant "safe" / "alarm" + open = the door slides open,
// interior glowing gold (safe) or red + a flashing siren light (alarm).
// Animation is driven by CSS transitions in index.css (.vault-door-panel,
// .vault-wheel, .laser-seal, .siren-light), not new state/logic.

interface Props {
  variant: "sealed" | "safe" | "alarm";
  open: boolean;
  className?: string;
}

export default function VaultDoor({ variant, open, className }: Props) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const steelId = `steel-${rawId}`;
  const glowId = `glow-${rawId}`;
  const isOpen = open && variant !== "sealed";

  return (
    <svg
      viewBox="0 0 120 96"
      className={className}
      role="img"
      aria-label={variant === "sealed" ? "Sealed vault door" : variant === "safe" ? "Open vault, safe" : "Open vault, alarm tripped"}
    >
      <defs>
        <linearGradient id={steelId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#475569" />
          <stop offset="45%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#334155" />
        </linearGradient>
        <radialGradient id={glowId} cx="0.5" cy="0.5" r="0.65">
          {variant === "alarm" ? (
            <>
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#450a0a" stopOpacity="1" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#451a03" stopOpacity="1" />
            </>
          )}
        </radialGradient>
      </defs>

      {/* Siren light, alarm variant only */}
      {variant === "alarm" && <circle cx="60" cy="7" r="5" fill="#f43f5e" className="siren-light" />}

      {/* Vault frame */}
      <rect x="4" y="14" width="112" height="78" rx="8" fill="#0f172a" stroke="#334155" strokeWidth="2" />

      {/* Interior (visible when the door is open) */}
      <rect x="12" y="20" width="96" height="66" rx="5" fill={isOpen ? `url(#${glowId})` : "#020617"} />
      {isOpen && variant === "safe" && (
        <g fill="#f59e0b" stroke="#b45309" strokeWidth="1">
          <rect x="34" y="66" width="22" height="7" rx="1.5" />
          <rect x="38" y="58" width="22" height="7" rx="1.5" />
          <rect x="64" y="66" width="22" height="7" rx="1.5" />
          <circle cx="72" cy="48" r="6" fill="#fbbf24" />
        </g>
      )}
      {isOpen && variant === "alarm" && (
        <g stroke="#fda4af" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M60 38 L82 72 L38 72 Z" fill="#7f1d1d" fillOpacity="0.55" />
          <line x1="60" y1="50" x2="60" y2="62" />
          <circle cx="60" cy="67" r="0.5" fill="#fda4af" />
        </g>
      )}

      {/* Door panel (slides when open) */}
      <g
        className="vault-door-panel"
        style={{ transform: isOpen ? "translateX(-63%)" : "translateX(0)" }}
      >
        <rect x="12" y="20" width="96" height="66" rx="5" fill={`url(#${steelId})`} stroke="#64748b" strokeWidth="1.5" />
        <rect x="20" y="27" width="80" height="52" rx="4" fill="none" stroke="#475569" strokeWidth="1" />
        {/* Corner bolts */}
        <g fill="#94a3b8">
          <circle cx="18" cy="26" r="2" />
          <circle cx="102" cy="26" r="2" />
          <circle cx="18" cy="80" r="2" />
          <circle cx="102" cy="80" r="2" />
        </g>
        {/* Vault wheel */}
        <g className="vault-wheel" style={{ transform: isOpen ? "rotate(210deg)" : "rotate(0deg)" }}>
          <circle cx="60" cy="53" r="12" fill="none" stroke="#cbd5e1" strokeWidth="3" />
          <line x1="60" y1="41" x2="60" y2="65" stroke="#cbd5e1" strokeWidth="3" />
          <line x1="49.6" y1="47" x2="70.4" y2="59" stroke="#cbd5e1" strokeWidth="3" />
          <line x1="49.6" y1="59" x2="70.4" y2="47" stroke="#cbd5e1" strokeWidth="3" />
        </g>
        <circle cx="60" cy="53" r="3.2" fill="#e2e8f0" />
        {/* Laser seal, only when closed */}
        {!isOpen && (
          <line x1="60" y1="22" x2="60" y2="84" stroke="#fb7185" strokeWidth="1.5" strokeDasharray="4 3" className="laser-seal" />
        )}
      </g>
    </svg>
  );
}
