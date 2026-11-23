import { useEffect, useState } from "react";

// Hook prefers-reduced-motion (Batch 5): satu-satunya pintu bagi komponen
// untuk tahu apakah user meminta gerak minim. Dipakai cipher scramble
// (VaultCard) dan cinematic reveal (CinematicReveal); sisanya ditangani
// blok @media di index.css.
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
