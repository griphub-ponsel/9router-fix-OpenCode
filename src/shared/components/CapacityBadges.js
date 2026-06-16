"use client";

import { CAPACITY_META } from "@/shared/constants/models";
import Tooltip from "./Tooltip";

export default function CapacityBadges({ caps, className = "", colorOverride, size = 16 }) {
  if (!caps) return null;
  const active = Object.keys(CAPACITY_META).filter((key) => caps[key]);
  if (active.length === 0) return null;

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {active.map((key) => (
        <Tooltip key={key} text={`${CAPACITY_META[key].label} - ${CAPACITY_META[key].desc}`}>
          <span
            className={`material-symbols-outlined leading-none cursor-help ${colorOverride || CAPACITY_META[key].color}`}
            style={{ fontSize: `${size}px` }}
          >
            {CAPACITY_META[key].icon}
          </span>
        </Tooltip>
      ))}
    </span>
  );
}
