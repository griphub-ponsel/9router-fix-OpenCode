"use client";

import { Input } from "@/shared/components";

/** Reusable endpoint row component — stacks vertically on mobile for readability */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 self-start sm:min-w-[88px] sm:text-center ${
          (badge === "CF" || badge === "TS") ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
        }`}>{label}</span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Input value={url} readOnly className="flex-1 font-mono text-sm min-w-0" />
        <button
          onClick={() => onCopy(url, copyId)}
          className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-[18px]">{copied === copyId ? "check" : "content_copy"}</span>
        </button>
        {actions}
      </div>
    </div>
  );
}
