"use client";

import { useEffect, useState } from "react";
import { notFound, useParams } from "next/navigation";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import { getMachineId } from "@/shared/utils/machine";
import ToolDetailClient from "./ToolDetailClient";

// Vite SPA cannot render Next async server components (they return a Promise).
export default function ToolDetailPage() {
  const params = useParams() || {};
  const toolId = params.toolId;
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

  if (!toolId || !CLI_TOOLS[toolId]) {
    notFound();
    return null;
  }

  if (!machineId) {
    return <main className="p-4 text-sm text-text-muted">Loading tool…</main>;
  }

  return <ToolDetailClient toolId={toolId} machineId={machineId} />;
}
