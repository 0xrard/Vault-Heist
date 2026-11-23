import { Bot } from "lucide-react";

// One-line dialogue bar for the Syndicate AI (the opponent in Solo mode).
// Compact and non-blocking: a plain layout element above the arena, never
// covering controls and never specially intercepting clicks. The line's content always
// comes from real game events (match start, Scout, lock-in, final result)
// driven from GameArena — not random text/timers.
export default function SyndicateBar({ line }: { line: string }) {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-violet-400/25 bg-violet-400/10 px-4 py-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-violet-400/20 text-violet-300">
        <Bot className="size-4.5" />
      </span>
      <div className="min-w-0 leading-tight">
        <div className="text-[10px] font-bold tracking-widest text-violet-300">SYNDICATE AI</div>
        <p className="text-sm text-violet-100 italic">&ldquo;{line}&rdquo;</p>
      </div>
    </div>
  );
}
