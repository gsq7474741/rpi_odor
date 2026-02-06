/**
 * ProjectionDataSet: A container for high-dimensional data with projection caching.
 * Adapted from TensorBoard Embedding Projector's DataSet class.
 * 
 * Key features:
 * - Deterministic sampling using seeded random
 * - KNN caching for t-SNE/UMAP
 * - Projection result caching
 * - Sphereize (normalize) support
 */

import * as numeric from 'numeric';
import { UMAP } from 'umap-js';
import { TSNE, computeKNN } from './bh-tsne';
import { createSeededRandom, generateShuffledIndices, type RandomGenerator } from './seeded-random';

export type ProjectionType = 'PCA' | 'TSNE' | 'UMAP';

export interface NearestEntry {
  index: number;
  dist: number;
}

export interface DataPoint {
  id: string | number;
  vector: number[];
  metadata: Record<string, unknown>;
  projections: Record<string, number>;
}

export interface TSNERunnerOptions {
  nComponents?: number;
  perplexity?: number;
  learningRate?: number;
  onStep?: (iteration: number, points: number[][]) => void;
}

export interface TSNERunner {
  iteration: number;
  isRunning: boolean;
  getPoints(): number[][];
  start(): void;
  pause(): void;
  stop(): void;
  step(): number[][];
}

export interface ProjectionDataSetOptions {
  seed?: number;
}

const MAX_SAMPLES = 5000;
const PCA_SAMPLE_DIM = 200;
const NUM_PCA_COMPONENTS = 10;

export class ProjectionDataSet {
  private points: DataPoint[];
  private shuffledIndices: number[];
  private rng: RandomGenerator;
  private seed: number;
  
  // KNN cache
  private nearestCache: Map<number, NearestEntry[][]> = new Map();
  
  // Projection state
  private projectionCache: Map<string, boolean> = new Map();
  private fracVariancesExplained: number[] = [];
  
  // t-SNE state
  private tsne: TSNE | null = null;
  private tsneIteration = 0;
  private tsneShouldPause = false;
  private tsneShouldStop = true;
  private hasTSNERun = false;
  
  // UMAP state
  private hasUmapRun = false;
  
  constructor(points: DataPoint[], options: ProjectionDataSetOptions = {}) {
    this.seed = options.seed ?? Date.now();
    this.rng = createSeededRandom(this.seed);
    this.points = points;
    this.shuffledIndices = generateShuffledIndices(points.length, this.rng);
  }
  
  getSeed(): number {
    return this.seed;
  }
  
  getPointCount(): number {
    return this.points.length;
  }
  
  getPoints(): DataPoint[] {
    return this.points;
  }
  
  getShuffledIndices(): number[] {
    return this.shuffledIndices;
  }
  
  /**
   * Get sampled indices for projection.
   * Always returns the same indices for the same seed.
   */
  getSampledIndices(maxSamples: number): number[] {
    return this.shuffledIndices.slice(0, Math.min(maxSamples, this.points.length));
  }
  
  /**
   * Get or compute KNN for the dataset.
   * Results are cached by k value.
   */
  getOrComputeKNN(k: number, sampledIndices?: number[]): NearestEntry[][] {
    const indices = sampledIndices || this.getSampledIndices(MAX_SAMPLES);
    const cacheKey = k;
    
    // Check if we have enough neighbors cached
    const cached = this.nearestCache.get(cacheKey);
    if (cached && cached.length === indices.length) {
      return cached;
    }
    
    // Compute KNN
    const sampledData = indices.map(i => this.points[i].vector);
    const nearest = computeKNN(sampledData, k);
    
    this.nearestCache.set(cacheKey, nearest);
    return nearest;
  }
  
  /**
   * Check if a projection type has been computed.
   */
  hasProjection(type: ProjectionType): boolean {
    return this.projectionCache.get(type) === true;
  }
  
  /**
   * Get projection coordinates for all points.
   */
  getProjection(type: ProjectionType, nComponents = 2): number[][] {
    const prefix = type.toLowerCase();
    return this.points.map(p => {
      const coords: number[] = [];
      for (let d = 0; d < nComponents; d++) {
        coords.push(p.projections[`${prefix}-${d}`] ?? 0);
      }
      return coords;
    });
  }
  
  /**
   * Get explained variance ratios (for PCA).
   */
  getExplainedVariance(): number[] {
    return this.fracVariancesExplained;
  }
  
  /**
   * Sphereize data: center to centroid and normalize to unit sphere.
   * Modifies vectors in place.
   */
  normalize(): void {
    const N = this.points.length;
    if (N === 0) return;
    
    const D = this.points[0].vector.length;
    
    // Compute centroid
    const centroid = new Array(D).fill(0);
    for (let i = 0; i < N; i++) {
      for (let d = 0; d < D; d++) {
        centroid[d] += this.points[i].vector[d];
      }
    }
    for (let d = 0; d < D; d++) {
      centroid[d] /= N;
    }
    
    // Shift by centroid and normalize to unit sphere
    for (let i = 0; i < N; i++) {
      const vec = this.points[i].vector;
      let norm2 = 0;
      for (let d = 0; d < D; d++) {
        vec[d] -= centroid[d];
        norm2 += vec[d] * vec[d];
      }
      const norm = Math.sqrt(norm2);
      if (norm > 0) {
        for (let d = 0; d < D; d++) {
          vec[d] /= norm;
        }
      }
    }
    
    // Clear caches since data changed
    this.nearestCache.clear();
    this.projectionCache.clear();
  }
  
  /**
   * Project data using PCA.
   */
  projectPCA(nComponents = 2): void {
    const cacheKey = `PCA-${nComponents}`;
    if (this.projectionCache.get(cacheKey)) return;
    
    const N = this.points.length;
    const D = this.points[0].vector.length;
    
    // Get sampled vectors using shuffled indices
    const sampledIndices = this.getSampledIndices(MAX_SAMPLES);
    let vectors = sampledIndices.map(i => this.points[i].vector);
    
    // Center the data
    const mean = new Array(D).fill(0);
    for (const vec of vectors) {
      for (let d = 0; d < D; d++) {
        mean[d] += vec[d];
      }
    }
    for (let d = 0; d < D; d++) {
      mean[d] /= vectors.length;
    }
    
    const centered = vectors.map(row => row.map((v, d) => v - mean[d]));
    
    // Random projection for high-dim data (deterministic with seed)
    let projectedVectors = centered;
    if (D > PCA_SAMPLE_DIM) {
      projectedVectors = this.randomProjection(centered, PCA_SAMPLE_DIM);
    }
    
    // Compute covariance matrix
    const cov = numeric.dot(numeric.transpose(projectedVectors), projectedVectors) as number[][];
    for (let i = 0; i < cov.length; i++) {
      for (let j = 0; j < cov[i].length; j++) {
        cov[i][j] /= projectedVectors.length;
      }
    }
    
    // Compute SVD
    const svd = numeric.svd(cov);
    const U = svd.U;
    const S = svd.S;
    
    // Compute explained variance
    const totalVariance = S.reduce((a, b) => a + b, 0);
    this.fracVariancesExplained = S.slice(0, NUM_PCA_COMPONENTS).map(s => s / totalVariance);
    
    // Project all sampled data onto principal components
    const numComponents = Math.min(nComponents, NUM_PCA_COMPONENTS);
    for (let c = 0; c < numComponents; c++) {
      const component = U.map(row => row[c]);
      for (let i = 0; i < sampledIndices.length; i++) {
        const pointIndex = sampledIndices[i];
        let sum = 0;
        for (let d = 0; d < projectedVectors[i].length; d++) {
          sum += projectedVectors[i][d] * component[d];
        }
        this.points[pointIndex].projections[`pca-${c}`] = sum;
      }
    }
    
    this.projectionCache.set(cacheKey, true);
  }
  
  /**
   * Random projection for dimensionality reduction.
   * Uses seeded random for reproducibility.
   */
  private randomProjection(data: number[][], targetDim: number): number[][] {
    const D = data[0].length;
    
    // Generate random projection matrix using seeded random
    const projMatrix: number[][] = [];
    for (let i = 0; i < targetDim; i++) {
      const row = new Array(D);
      for (let j = 0; j < D; j++) {
        row[j] = (this.rng() - 0.5) * 2 / Math.sqrt(targetDim);
      }
      projMatrix.push(row);
    }
    
    // Project data
    return data.map(row => {
      const result = new Array(targetDim);
      for (let i = 0; i < targetDim; i++) {
        let sum = 0;
        for (let j = 0; j < D; j++) {
          sum += row[j] * projMatrix[i][j];
        }
        result[i] = sum;
      }
      return result;
    });
  }
  
  /**
   * Create an iterative t-SNE runner.
   */
  createTSNERunner(options: TSNERunnerOptions = {}): TSNERunner {
    const nComponents = options.nComponents ?? 2;
    const perplexity = options.perplexity ?? 30;
    const learningRate = options.learningRate ?? 10;
    const onStep = options.onStep;
    
    const sampledIndices = this.getSampledIndices(MAX_SAMPLES);
    const k = Math.min(Math.floor(3 * perplexity), sampledIndices.length - 1);
    
    // Use seeded random for t-SNE initialization
    const tsneRng = createSeededRandom(this.seed + 1); // Different seed for t-SNE
    
    const tsne = new TSNE({
      dim: nComponents,
      perplexity,
      epsilon: learningRate,
      rng: tsneRng,
    });
    
    // Compute KNN
    const nearest = this.getOrComputeKNN(k, sampledIndices);
    tsne.initDataDist(nearest);
    
    this.tsne = tsne;
    this.tsneIteration = 0;
    this.tsneShouldPause = false;
    this.tsneShouldStop = false;
    this.hasTSNERun = true;
    
    let animationFrameId: number | null = null;
    
    const updateProjections = () => {
      const solution = tsne.getSolution();
      for (let i = 0; i < sampledIndices.length; i++) {
        const pointIndex = sampledIndices[i];
        for (let d = 0; d < nComponents; d++) {
          this.points[pointIndex].projections[`tsne-${d}`] = solution[i * nComponents + d];
        }
      }
      this.projectionCache.set('TSNE', true);
    };
    
    const getPoints = (): number[][] => {
      return sampledIndices.map(idx => {
        const coords: number[] = [];
        for (let d = 0; d < nComponents; d++) {
          coords.push(this.points[idx].projections[`tsne-${d}`] ?? 0);
        }
        return coords;
      });
    };
    
    const step = (): number[][] => {
      tsne.step();
      this.tsneIteration++;
      updateProjections();
      return getPoints();
    };
    
    const runStep = () => {
      if (this.tsneShouldStop) {
        animationFrameId = null;
        return;
      }
      
      if (!this.tsneShouldPause) {
        const points = step();
        onStep?.(this.tsneIteration, points);
      }
      
      animationFrameId = requestAnimationFrame(runStep);
    };
    
    // Create a reference to the dataset for closures
    const dataset = this;
    
    const runner: TSNERunner = {
      get iteration() {
        return dataset.tsneIteration;
      },
      get isRunning() {
        return animationFrameId !== null && !dataset.tsneShouldPause;
      },
      getPoints,
      start: () => {
        dataset.tsneShouldPause = false;
        dataset.tsneShouldStop = false;
        if (animationFrameId === null) {
          animationFrameId = requestAnimationFrame(runStep);
        }
      },
      pause: () => {
        dataset.tsneShouldPause = true;
      },
      stop: () => {
        dataset.tsneShouldStop = true;
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
      },
      step,
    };
    
    return runner;
  }
  
  /**
   * Project data using UMAP.
   */
  async projectUMAP(
    nComponents = 2,
    nNeighbors = 15,
    minDist = 0.1,
    onProgress?: (progress: number, message: string) => void
  ): Promise<void> {
    // Cache key includes nComponents to handle 2D/3D switching
    const cacheKey = `UMAP-${nComponents}`;
    if (this.projectionCache.get(cacheKey)) return;
    
    onProgress?.(0, 'Initializing UMAP...');
    
    const sampledIndices = this.getSampledIndices(MAX_SAMPLES);
    const sampledData = sampledIndices.map(i => this.points[i].vector);
    
    // Clamp nNeighbors to be less than data point count
    const effectiveNeighbors = Math.min(nNeighbors, sampledData.length - 1);
    if (effectiveNeighbors < 2) {
      throw new Error(`数据点太少 (${sampledData.length})，UMAP 至少需要 3 个数据点`);
    }
    
    // Create a fresh seeded random for UMAP (don't share with other operations)
    const umapRng = createSeededRandom(this.seed + 7919);
    
    const umap = new UMAP({
      nComponents,
      nNeighbors: effectiveNeighbors,
      minDist,
      nEpochs: 200,
      random: umapRng,
    });
    
    onProgress?.(10, `Fitting UMAP (${sampledData.length} points, ${effectiveNeighbors} neighbors)...`);
    
    const embedding = umap.fit(sampledData);
    
    // Validate embedding - check for NaN values
    let hasNaN = false;
    for (let i = 0; i < embedding.length && !hasNaN; i++) {
      for (let d = 0; d < nComponents; d++) {
        if (isNaN(embedding[i][d]) || !isFinite(embedding[i][d])) {
          hasNaN = true;
          break;
        }
      }
    }
    if (hasNaN) {
      console.warn('UMAP produced NaN/Infinity values, falling back to random projection');
      // Use random positions as fallback
      const fallbackRng = createSeededRandom(this.seed);
      for (let i = 0; i < embedding.length; i++) {
        for (let d = 0; d < nComponents; d++) {
          if (isNaN(embedding[i][d]) || !isFinite(embedding[i][d])) {
            embedding[i][d] = fallbackRng() * 2 - 1;
          }
        }
      }
    }
    
    // Clear old UMAP projections before storing new ones
    for (const point of this.points) {
      for (let d = 0; d < 3; d++) {
        delete point.projections[`umap-${d}`];
      }
    }
    
    // Store projections
    for (let i = 0; i < sampledIndices.length; i++) {
      const pointIndex = sampledIndices[i];
      for (let d = 0; d < nComponents; d++) {
        this.points[pointIndex].projections[`umap-${d}`] = embedding[i][d];
      }
    }
    
    this.hasUmapRun = true;
    this.projectionCache.set(cacheKey, true);
    
    onProgress?.(100, 'UMAP complete');
  }
  
  /**
   * Clear all cached projections.
   */
  clearProjections(): void {
    for (const point of this.points) {
      point.projections = {};
    }
    this.projectionCache.clear();
    this.hasTSNERun = false;
    this.hasUmapRun = false;
    this.tsneIteration = 0;
  }
  
  /**
   * Stop any running t-SNE computation.
   */
  stopTSNE(): void {
    this.tsneShouldStop = true;
  }
}
