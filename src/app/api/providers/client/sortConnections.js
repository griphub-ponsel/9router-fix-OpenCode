export function sortConnections(connections, sort, providerOrder = []) {
  const list = [...connections];

  if (sort === "provider") {
    return list.sort((a, b) => {
      const orderA = providerOrder.indexOf(a.provider);
      const orderB = providerOrder.indexOf(b.provider);
      if (orderA !== orderB) return orderA - orderB;
      return (
        (a.provider || "").localeCompare(b.provider || "") ||
        (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER)
      );
    });
  }

  return list.sort((a, b) => {
    const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
    const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return (a.provider || "").localeCompare(b.provider || "");
  });
}
