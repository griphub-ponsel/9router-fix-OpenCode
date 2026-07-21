"use client";

import { useEffect, useState } from "react";
import { getMachineId } from "@/shared/utils/machine";
import CLIToolsPageClient from "./CLIToolsPageClient";

// Vite SPA cannot render Next async server components (they return a Promise).
export default function CLIToolsPage() {
  const [machineId, setMachineId] = useState("");

  useEffect(() => {
    let alive = true;
    getMachineId()
      .then((id) => {
        if (alive) setMachineId(id || "");
      })
      .catch(() => {
        if (alive) setMachineId("");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!machineId) {
    return <main className="p-4 text-sm text-text-muted">Loading CLI tools…</main>;
  }

  return <CLIToolsPageClient machineId={machineId} />;
}
