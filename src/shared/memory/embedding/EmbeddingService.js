/**
 * Embedding Service
 * Generates vector embeddings for semantic search.
 * 
 * Providers:
 * - 'local': @xenova/transformers (all-MiniLM-L6-v2, 384 dim) — recommended for offline
 * - 'openai': OpenAI text-embedding-3-small or text-embedding-ada-002 (via 9Router or direct key)
 * - 'none': stub that returns null (graceful degradation)
 */

const crypto = require('crypto');

// Keep optional deps out of static bundler resolution to avoid noisy build warnings.
function optionalRequire(moduleName) {
  const runtimeRequire = typeof __non_webpack_require__ === 'function'
    ? __non_webpack_require__
    : eval('require');
  return runtimeRequire(moduleName);
}

class EmbeddingService {
  constructor(options = {}) {
    this.provider = options.provider || 'local'; // 'local' | 'openai' | 'none'
    this.model = options.model || null;
    this.apiKey = options.apiKey || null;
    this.baseUrl = options.baseUrl || null; // for OpenAI-compatible endpoint (e.g. 9Router /v1)
    this.dimension = options.dimension || null;

    this._pipeline = null;
    this._initialized = false;
    this._initError = null;
  }

  /**
   * Initialize the embedding provider (lazy).
   */
  async initialize() {
    if (this._initialized) return;

    try {
      if (this.provider === 'none') {
        this._initialized = true;
        return;
      }

      if (this.provider === 'local') {
        await this._initLocal();
      } else if (this.provider === 'openai') {
        // No heavy init for OpenAI, just validate config
        if (!this.apiKey && !this.baseUrl) {
          console.warn('[EmbeddingService] OpenAI provider selected but no apiKey/baseUrl provided. Will try 9Router default.');
        }
        this._initialized = true;
      } else {
        throw new Error(`Unknown embedding provider: ${this.provider}`);
      }
    } catch (err) {
      this._initError = err;
      console.warn('[EmbeddingService] Initialization failed, falling back to none:', err.message);
      this.provider = 'none';
      this._initialized = true;
    }
  }

  async _initLocal() {
    try {
      // Lazy require — package is optional and may be absent in lightweight installs.
      const { pipeline, env } = optionalRequire('@xenova/transformers');
      
      // Use a small, fast model. all-MiniLM-L6-v2 produces 384-dim vectors (matches schema hint)
      const modelName = this.model || 'Xenova/all-MiniLM-L6-v2';
      
      // Disable local model cache write if running in restricted env (optional)
      env.useBrowserCache = false;

      this._pipeline = await pipeline('feature-extraction', modelName, {
        quantized: true // smaller & faster
      });

      this.dimension = 384;
      this._initialized = true;
      console.log('[EmbeddingService] Local embeddings ready:', modelName);
    } catch (err) {
      // Package not installed or load failed
      throw new Error(`Local embedding model failed to load. Install with: npm install @xenova/transformers\n${err.message}`);
    }
  }

  /**
   * Generate embedding for a single text.
   * @param {string} text
   * @returns {Promise<number[]|null>}
   */
  async embed(text) {
    await this.initialize();

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return null;
    }

    const cleaned = text.trim().slice(0, 8000); // safety cap

    if (this.provider === 'none') {
      return this._stubEmbedding(cleaned);
    }

    if (this.provider === 'local' && this._pipeline) {
      return await this._embedLocal(cleaned);
    }

    if (this.provider === 'openai') {
      return await this._embedOpenAI(cleaned);
    }

    return this._stubEmbedding(cleaned);
  }

  async embedBatch(texts) {
    const results = [];
    for (const t of texts) {
      const e = await this.embed(t);
      results.push(e);
    }
    return results;
  }

  async _embedLocal(text) {
    const output = await this._pipeline(text, {
      pooling: 'mean',
      normalize: true
    });

    // output.data is Float32Array
    const vector = Array.from(output.data);
    return vector;
  }

  async _embedOpenAI(text) {
    const model = this.model || 'text-embedding-3-small';
    const url = this.baseUrl 
      ? `${this.baseUrl.replace(/\/$/, '')}/embeddings`
      : 'https://api.openai.com/v1/embeddings';

    const headers = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    } else if (process.env.OPENAI_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.OPENAI_API_KEY}`;
    }

    const body = {
      model,
      input: text
    };

    // Use global fetch (Node 18+ / Next.js)
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI embedding failed: ${res.status} ${errText}`);
    }

    const json = await res.json();
    const vector = json?.data?.[0]?.embedding;
    
    if (!Array.isArray(vector)) {
      throw new Error('Invalid embedding response from OpenAI-compatible endpoint');
    }

    if (!this.dimension) this.dimension = vector.length;
    return vector;
  }

  /**
   * Deterministic stub embedding (for demo / when no provider).
   * Not useful for semantic search, but prevents crashes.
   */
  _stubEmbedding(text) {
    const hash = crypto.createHash('sha256').update(text).digest();
    const dim = this.dimension || 384;
    const vec = new Array(dim);
    
    for (let i = 0; i < dim; i++) {
      // Use bytes from hash cycling + some noise
      const byte = hash[i % hash.length];
      vec[i] = ((byte / 255) - 0.5) * 2; // range -1..1
    }
    
    // Normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
  }

  /**
   * Cosine similarity between two vectors.
   */
  static cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    
    let dot = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  getDimension() {
    return this.dimension || 384;
  }

  getProvider() {
    return this.provider;
  }
}

// Singleton default instance (can be overridden)
let defaultInstance = null;

function getDefaultEmbeddingService() {
  if (!defaultInstance) {
    defaultInstance = new EmbeddingService({
      provider: process.env.MEMORY_EMBEDDING_PROVIDER || 'local'
    });
  }
  return defaultInstance;
}

module.exports = {
  EmbeddingService,
  getDefaultEmbeddingService
};
