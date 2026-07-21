"use client";

import { useEffect, useState } from "react";
import { getMachineId } from "@/shared/utils/machine";
import EndpointPageClient from "./endpoint/EndpointPageClient";

// Vite SPA cannot render Next async server components (they return a Promise).
export default function DashboardPage() {
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
    return <main className="p-4 text-sm text-text-muted">Loading…</main>;
  }

  return <EndpointPageClient machineId={machineId} />;
}
