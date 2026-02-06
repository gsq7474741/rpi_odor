/**
 * Frontend dimensionality reduction module.
 * Supports PCA, t-SNE, and UMAP for datasets up to 5000 samples.
 * 
 * Adapted from TensorBoard Embedding Projector.
 */

import * as numeric from 'numeric';
import { UMAP } from 'umap-js';
import { TSNE, computeKNN } from './bh-tsne';

export type ProjectionType = 'PCA' | 'TSNE' | 'UMAP';

export interface ProjectionResult {
  points: number[][];
  explained_variance?: number[];
}

export interface ProjectionOptions {
  type: ProjectionType;
  nComponents?: number;
  perplexity?: number;
  nNeighbors?: number;
  minDist?: number;
  nIterations?: number;
  sphereize?: boolean;
  onProgress?: (progress: number, message: string) => void;
}

// TSNERunner interface is now defined in dataset.ts
import type { TSNERunner as TSNERunnerType } from './dataset';

const MAX_SAMPLES = 5000;
const PCA_SAMPLE_DIM = 200;

/**
 * Sphereize data: center to centroid and normalize to unit sphere.
 * This is TensorBoard's "Spherize data" feature.
 */
export function sphereizeData(data: number[][]): number[][] {
  if (data.length === 0) return [];
  
  const N = data.length;
  const D = data[0].length;
  
  // Compute centroid
  const centroid = new Array(D).fill(0);
  for (let i = 0; i < N; i++) {
    for (let d = 0; d < D; d++) {
      centroid[d] += data[i][d];
    }
  }
  for (let d = 0; d < D; d++) {
    centroid[d] /= N;
  }
  
  // Shift by centroid and normalize to unit sphere
  const result: number[][] = [];
  for (let i = 0; i < N; i++) {
    const shifted = new Array(D);
    let norm2 = 0;
    for (let d = 0; d < D; d++) {
      shifted[d] = data[i][d] - centroid[d];
      norm2 += shifted[d] * shifted[d];
    }
    const norm = Math.sqrt(norm2);
    if (norm > 0) {
      for (let d = 0; d < D; d++) {
        shifted[d] /= norm;
      }
    }
    result.push(shifted);
  }
  
  return result;
}

/**
 * Project high-dimensional data to lower dimensions.
 */
export async function projectData(
  data: number[][],
  options: ProjectionOptions
): Promise<ProjectionResult> {
  if (data.length === 0) {
    return { points: [] };
  }

  if (data.length > MAX_SAMPLES) {
    console.warn(`Data size ${data.length} exceeds max ${MAX_SAMPLES}, sampling...`);
    data = sampleData(data, MAX_SAMPLES);
  }

  // Apply sphereize if requested
  if (options.sphereize) {
    data = sphereizeData(data);
  }

  const nComponents = options.nComponents || 2;
  const onProgress = options.onProgress || (() => {});

  switch (options.type) {
    case 'PCA':
      return projectPCA(data, nComponents, onProgress);
    case 'TSNE':
      return projectTSNE(data, nComponents, options.perplexity || 30, options.nIterations || 500, onProgress);
    case 'UMAP':
      return projectUMAP(data, nComponents, options.nNeighbors || 15, options.minDist || 0.1, onProgress);
    default:
      throw new Error(`Unknown projection type: ${options.type}`);
  }
}

/**
 * Random sampling for large datasets.
 */
function sampleData(data: number[][], maxSamples: number): number[][] {
  const indices = Array.from({ length: data.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, maxSamples).map(i => data[i]);
}

/**
 * PCA using SVD decomposition.
 */
function projectPCA(
  data: number[][],
  nComponents: number,
  onProgress: (progress: number, message: string) => void
): ProjectionResult {
  onProgress(0, 'Computing PCA...');

  const N = data.length;
  const D = data[0].length;

  // Center the data
  const mean = new Array(D).fill(0);
  for (let i = 0; i < N; i++) {
    for (let d = 0; d < D; d++) {
      mean[d] += data[i][d];
    }
  }
  for (let d = 0; d < D; d++) {
    mean[d] /= N;
  }

  const centered = data.map(row => row.map((v, d) => v - mean[d]));

  onProgress(20, 'Centering data...');

  // If dimensions are too high, use random projection first
  let vectors = centered;
  if (D > PCA_SAMPLE_DIM) {
    onProgress(30, 'Random projection for high-dim data...');
    vectors = randomProjection(centered, PCA_SAMPLE_DIM);
  }

  onProgress(40, 'Computing covariance matrix...');

  // Compute covariance matrix
  const cov = numeric.dot(numeric.transpose(vectors), vectors) as number[][];
  for (let i = 0; i < cov.length; i++) {
    for (let j = 0; j < cov[i].length; j++) {
      cov[i][j] /= N;
    }
  }

  onProgress(60, 'Computing SVD...');

  // Compute SVD
  const svd = numeric.svd(cov);
  const U = svd.U;
  const S = svd.S;

  onProgress(80, 'Projecting data...');

  // Project data onto principal components
  const components = U.slice(0, nComponents).map(col => col.slice(0, vectors[0].length));
  const projected = vectors.map(row => {
    const result = new Array(nComponents);
    for (let c = 0; c < nComponents; c++) {
      let sum = 0;
      for (let d = 0; d < row.length; d++) {
        sum += row[d] * components[c][d];
      }
      result[c] = sum;
    }
    return result;
  });

  // Compute explained variance
  const totalVariance = S.reduce((a, b) => a + b, 0);
  const explainedVariance = S.slice(0, nComponents).map(s => s / totalVariance);

  onProgress(100, 'PCA complete');

  return {
    points: projected,
    explained_variance: explainedVariance,
  };
}

/**
 * Random projection for dimensionality reduction.
 */
function randomProjection(data: number[][], targetDim: number): number[][] {
  const D = data[0].length;
  
  // Generate random projection matrix
  const projMatrix: number[][] = [];
  for (let i = 0; i < targetDim; i++) {
    const row = new Array(D);
    for (let j = 0; j < D; j++) {
      row[j] = (Math.random() - 0.5) * 2 / Math.sqrt(targetDim);
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
 * Barnes-Hut t-SNE implementation.
 */
async function projectTSNE(
  data: number[][],
  nComponents: number,
  perplexity: number,
  nIterations: number,
  onProgress: (progress: number, message: string) => void
): Promise<ProjectionResult> {
  onProgress(0, 'Computing KNN for t-SNE...');

  const N = data.length;
  const K = Math.min(3 * perplexity, N - 1);

  // Compute KNN
  const nearest = computeKNN(data, K);

  onProgress(20, 'Initializing t-SNE...');

  const tsne = new TSNE({
    dim: nComponents,
    perplexity,
    epsilon: 10,
  });

  tsne.initDataDist(nearest);

  onProgress(30, 'Running t-SNE iterations...');

  // Run iterations with progress updates
  const updateInterval = Math.max(1, Math.floor(nIterations / 20));
  for (let i = 0; i < nIterations; i++) {
    tsne.step();
    if (i % updateInterval === 0) {
      const progress = 30 + (i / nIterations) * 70;
      onProgress(progress, `t-SNE iteration ${i}/${nIterations}`);
      // Yield to UI thread
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  onProgress(100, 't-SNE complete');

  // Extract solution
  const solution = tsne.getSolution();
  const points: number[][] = new Array(N);
  for (let i = 0; i < N; i++) {
    points[i] = new Array(nComponents);
    for (let d = 0; d < nComponents; d++) {
      points[i][d] = solution[i * nComponents + d];
    }
  }

  return { points };
}

/**
 * UMAP using umap-js library.
 */
async function projectUMAP(
  data: number[][],
  nComponents: number,
  nNeighbors: number,
  minDist: number,
  onProgress: (progress: number, message: string) => void
): Promise<ProjectionResult> {
  onProgress(0, 'Initializing UMAP...');

  const umap = new UMAP({
    nComponents,
    nNeighbors,
    minDist,
    nEpochs: 200,
  });

  onProgress(10, 'Fitting UMAP...');

  // Fit UMAP
  const embedding = umap.fit(data);

  onProgress(100, 'UMAP complete');

  return { points: embedding };
}

/**
 * Check if frontend projection is recommended based on data size.
 */
export function shouldUseFrontendProjection(sampleCount: number): boolean {
  return sampleCount <= MAX_SAMPLES;
}

/**
 * Simple K-Means clustering implementation.
 */
export function simpleKMeans(
  data: number[][],
  k: number,
  maxIterations = 100,
  seed?: number
): { labels: number[]; centroids: number[][] } {
  const N = data.length;
  if (N === 0) {
    return { labels: [], centroids: [] };
  }
  const D = data[0].length;

  // Clamp k to not exceed data point count
  const effectiveK = Math.min(k, N);

  // Seeded random for deterministic results
  let _seed = seed ?? 42;
  const seededRandom = () => {
    _seed = (_seed * 16807 + 0) % 2147483647;
    return (_seed - 1) / 2147483646;
  };

  // Initialize centroids randomly from data points
  const indices = Array.from({ length: N }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  let centroids = indices.slice(0, effectiveK).map(i => [...data[i]]);
  let labels = new Array(N).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign points to nearest centroid
    const newLabels = new Array(N);
    for (let i = 0; i < N; i++) {
      let minDist = Infinity;
      let minIdx = 0;
      for (let c = 0; c < effectiveK; c++) {
        let dist = 0;
        for (let d = 0; d < D; d++) {
          const diff = data[i][d] - centroids[c][d];
          dist += diff * diff;
        }
        if (dist < minDist) {
          minDist = dist;
          minIdx = c;
        }
      }
      newLabels[i] = minIdx;
    }

    // Check convergence
    let changed = false;
    for (let i = 0; i < N; i++) {
      if (newLabels[i] !== labels[i]) {
        changed = true;
        break;
      }
    }
    labels = newLabels;

    if (!changed) break;

    // Update centroids
    const counts = new Array(effectiveK).fill(0);
    const sums = Array.from({ length: effectiveK }, () => new Array(D).fill(0));

    for (let i = 0; i < N; i++) {
      const c = labels[i];
      counts[c]++;
      for (let d = 0; d < D; d++) {
        sums[c][d] += data[i][d];
      }
    }

    for (let c = 0; c < effectiveK; c++) {
      if (counts[c] > 0) {
        for (let d = 0; d < D; d++) {
          centroids[c][d] = sums[c][d] / counts[c];
        }
      }
    }
  }

  return { labels, centroids };
}

/**
 * Create an iterative t-SNE runner for real-time visualization.
 * Similar to TensorBoard's continuous t-SNE rendering.
 */
export function createTSNERunner(
  data: number[][],
  options: {
    nComponents?: number;
    perplexity?: number;
    learningRate?: number;
    sphereize?: boolean;
    onStep?: (iteration: number, points: number[][]) => void;
  } = {}
): TSNERunnerType {
  const nComponents = options.nComponents || 2;
  const perplexity = options.perplexity || 30;
  const learningRate = options.learningRate || 10;
  const onStep = options.onStep || (() => {});

  // Apply sphereize if requested
  let processedData = options.sphereize ? sphereizeData(data) : data;
  
  // Compute k for KNN
  const k = Math.floor(3 * perplexity);
  
  // Initialize t-SNE
  const tsne = new TSNE({
    dim: nComponents,
    perplexity,
    epsilon: learningRate,
  });

  let iteration = 0;
  let isRunning = false;
  let shouldStop = false;
  let animationFrameId: number | null = null;
  let initialized = false;

  // Initialize data distribution (async)
  const initPromise = (async () => {
    const nearest = computeKNN(processedData, k);
    tsne.initDataDist(nearest);
    initialized = true;
  })();

  const getPoints = (): number[][] => {
    if (!initialized || !tsne.getSolution()) {
      // Return random initialization
      return processedData.map(() => {
        const point = [];
        for (let d = 0; d < nComponents; d++) {
          point.push((Math.random() - 0.5) * 0.01);
        }
        return point;
      });
    }

    const solution = tsne.getSolution();
    const N = processedData.length;
    const points: number[][] = [];
    for (let i = 0; i < N; i++) {
      const point = [];
      for (let d = 0; d < nComponents; d++) {
        point.push(solution[i * nComponents + d]);
      }
      points.push(point);
    }
    return points;
  };

  const step = (): number[][] => {
    if (!initialized) {
      return getPoints();
    }
    tsne.step();
    iteration++;
    const points = getPoints();
    onStep(iteration, points);
    return points;
  };

  const runLoop = () => {
    if (shouldStop || !isRunning) {
      return;
    }
    step();
    animationFrameId = requestAnimationFrame(runLoop);
  };

  const start = async () => {
    await initPromise;
    if (isRunning) return;
    isRunning = true;
    shouldStop = false;
    runLoop();
  };

  const pause = () => {
    isRunning = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };

  const stop = () => {
    shouldStop = true;
    isRunning = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    iteration = 0;
  };

  return {
    get iteration() { return iteration; },
    get isRunning() { return isRunning; },
    getPoints,
    start,
    pause,
    stop,
    step,
  };
}

export { TSNE, computeKNN } from './bh-tsne';
export { ProjectionDataSet, type DataPoint, type TSNERunner, type TSNERunnerOptions, type NearestEntry } from './dataset';
export { createSeededRandom, seededShuffle, seededSample, generateShuffledIndices, type RandomGenerator } from './seeded-random';
