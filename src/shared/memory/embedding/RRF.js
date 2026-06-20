/**
 * Reciprocal Rank Fusion (RRF)
 * Standard method to combine ranked lists from different retrievers.
 * 
 * score(d) = sum over retrievers ( 1 / (k + rank(d)) )
 */

const DEFAULT_K = 60;

function reciprocalRankFusion(rankedLists, options = {}) {
  const k = options.k || DEFAULT_K;
  const topK = options.topK || 20;
  const weights = options.weights || null; // e.g. { keyword: 1.0, vector: 1.0 }

  const scores = new Map(); // id -> score
  const memoryById = new Map(); // id -> memory object

  rankedLists.forEach((list, listIndex) => {
    const weight = weights ? (weights[listIndex] || weights['default'] || 1.0) : 1.0;

    list.forEach((item, rank) => {
      // Support both {memory, score} and raw memory shapes
      const mem = item.memory || item;
      const id = mem.id || mem.memory_id || JSON.stringify(mem).slice(0, 32);

      if (!memoryById.has(id)) {
        memoryById.set(id, mem);
      }

      const current = scores.get(id) || 0;
      const rrfScore = 1 / (k + (rank + 1)); // rank is 0-based
      scores.set(id, current + (rrfScore * weight));
    });
  });

  // Sort by fused score desc
  const sorted = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id, fusedScore]) => ({
      memory: memoryById.get(id),
      score: fusedScore
    }));

  return sorted;
}

module.exports = {
  reciprocalRankFusion,
  RRF: reciprocalRankFusion
};
