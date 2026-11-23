# Batch 6.3.12 — README Heading Correction (Documentation Only)

**Date:** 23 November 2026
**Type:** One-line documentation change. No code, no config, no other text touched. Post-freeze micro-batch under the freeze rule, re-frozen on completion.
**Trigger:** The README section heading "Why This Game Breaks on a Transparent Blockchain" was flagged in review: it reads as if Vault Heist itself is broken, while the section's actual claim is the reverse — a game like this cannot work on a transparent chain, which is the problem FHE solves.

**Change:** The heading now reads **"Why Transparent Blockchains Break Games Like This"** (chosen from four proposed alternatives). The section body is unchanged — it already argued exactly this.

**Verification:** Heading confirmed present in the rebuilt freeze archive; the standard suite is unaffected (documentation only) and was re-run for the freeze record: Hardhat 13 passing, `tsc --noEmit` exit 0, production build exit 0, locked-file MD5s unchanged.
