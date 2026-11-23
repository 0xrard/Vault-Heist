import { useEffect, useState } from "react";

// prefers-reduced-motion hook (Batch 5): the single gateway for components
// to know whether the user requested reduced motion. Used by the cipher scramble
// (VaultCard) and the cinematic reveal (CinematicReveal); the rest is handled by
// the @media block in index.css.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
