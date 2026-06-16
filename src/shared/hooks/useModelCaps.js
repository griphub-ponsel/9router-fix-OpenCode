"use client";

import { useEffect, useState } from "react";

export function useModelCaps() {
  const [byFull, setByFull] = useState({});
  const [byId, setById] = useState({});

  useEffect(() => {
    let alive = true;

    async function fetchCaps() {
      try {
        const response = await fetch("/api/models", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        const full = {};
        const id = {};

        for (const model of data.models || []) {
          if (!model.caps) continue;
          if (model.fullModel) full[model.fullModel] = model.caps;
          if (model.model) id[model.model] = model.caps;
        }

        if (alive) {
          setByFull(full);
          setById(id);
        }
      } catch {
        // Capability badges are optional UI hints.
      }
    }

    fetchCaps();
    return () => {
      alive = false;
    };
  }, []);

  const getCaps = (key) => {
    if (!key) return null;
    if (byFull[key]) return byFull[key];
    const bare = key.includes("/") ? key.slice(key.indexOf("/") + 1) : key;
    return byId[bare] || null;
  };

  return { getCaps };
}
