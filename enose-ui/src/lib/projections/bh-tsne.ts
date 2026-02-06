/**
 * Barnes-Hut t-SNE implementation.
 * Adapted from TensorBoard Embedding Projector.
 * 
 * @license Apache-2.0
 * Copyright 2016 The TensorFlow Authors. All Rights Reserved.
 */

import { SPTree, SPNode } from './sptree';
import { createSeededRandom } from './seeded-random';

type AugmSPNode = SPNode & {
  numCells: number;
  yCell: number[];
  rCell: number;
};

const THETA = 0.8;
const MIN_POSSIBLE_PROB = 1e-9;

let return_v = false;
let v_val = 0;

export function dist2(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors a and b must be of same length');
  }
  let result = 0;
  for (let i = 0; i < a.length; ++i) {
    const diff = a[i] - b[i];
    result += diff * diff;
  }
  return result;
}

function dist2_2D(a: number[], b: number[]): number {
  const dX = a[0] - b[0];
  const dY = a[1] - b[1];
  return dX * dX + dY * dY;
}

function dist2_3D(a: number[], b: number[]): number {
  const dX = a[0] - b[0];
  const dY = a[1] - b[1];
  const dZ = a[2] - b[2];
  return dX * dX + dY * dY + dZ * dZ;
}

function gaussRandom(rng: () => number): number {
  if (return_v) {
    return_v = false;
    return v_val;
  }
  let u = 2 * rng() - 1;
  let v = 2 * rng() - 1;
  let r = u * u + v * v;
  if (r === 0 || r > 1) {
    return gaussRandom(rng);
  }
  const c = Math.sqrt((-2 * Math.log(r)) / r);
  v_val = v * c;
  return_v = true;
  return u * c;
}

function randn(rng: () => number, mu: number, std: number) {
  return mu + gaussRandom(rng) * std;
}

function zeros(n: number): Float64Array {
  return new Float64Array(n);
}

function randnMatrix(n: number, d: number, rng: () => number) {
  const nd = n * d;
  const x = zeros(nd);
  for (let i = 0; i < nd; ++i) {
    x[i] = randn(rng, 0, 0.0001);
  }
  return x;
}

function arrayofs(n: number, d: number, val: number) {
  const x: number[][] = [];
  for (let i = 0; i < n; ++i) {
    x.push(d === 3 ? [val, val, val] : [val, val]);
  }
  return x;
}

function nearest2P(
  nearest: { index: number; dist: number }[][],
  perplexity: number,
  tol: number
) {
  const N = nearest.length;
  const Htarget = Math.log(perplexity);
  const P = zeros(N * N);
  const K = nearest[0].length;
  const pRow: number[] = new Array(K);

  for (let i = 0; i < N; ++i) {
    const neighbors = nearest[i];
    let betaMin = -Infinity;
    let betaMax = Infinity;
    let beta = 1;
    const maxTries = 50;
    let numTries = 0;

    while (true) {
      let psum = 0;
      for (let k = 0; k < neighbors.length; ++k) {
        const neighbor = neighbors[k];
        let pij = i === neighbor.index ? 0 : Math.exp(-neighbor.dist * beta);
        pij = Math.max(pij, MIN_POSSIBLE_PROB);
        pRow[k] = pij;
        psum += pij;
      }

      let Hhere = 0;
      for (let k = 0; k < pRow.length; ++k) {
        pRow[k] /= psum;
        const pij = pRow[k];
        if (pij > 1e-7) {
          Hhere -= pij * Math.log(pij);
        }
      }

      if (Hhere > Htarget) {
        betaMin = beta;
        beta = betaMax === Infinity ? beta * 2 : (beta + betaMax) / 2;
      } else {
        betaMax = beta;
        beta = betaMin === -Infinity ? beta / 2 : (beta + betaMin) / 2;
      }

      numTries++;
      if (numTries >= maxTries || Math.abs(Hhere - Htarget) < tol) {
        break;
      }
    }

    for (let k = 0; k < pRow.length; ++k) {
      const pij = pRow[k];
      const j = neighbors[k].index;
      P[i * N + j] = pij;
    }
  }

  const N2 = N * 2;
  for (let i = 0; i < N; ++i) {
    for (let j = i + 1; j < N; ++j) {
      const i_j = i * N + j;
      const j_i = j * N + i;
      const value = (P[i_j] + P[j_i]) / N2;
      P[i_j] = value;
      P[j_i] = value;
    }
  }
  return P;
}

function sign(x: number) {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

function computeForce_2d(force: number[], mult: number, pointA: number[], pointB: number[]) {
  force[0] += mult * (pointA[0] - pointB[0]);
  force[1] += mult * (pointA[1] - pointB[1]);
}

function computeForce_3d(force: number[], mult: number, pointA: number[], pointB: number[]) {
  force[0] += mult * (pointA[0] - pointB[0]);
  force[1] += mult * (pointA[1] - pointB[1]);
  force[2] += mult * (pointA[2] - pointB[2]);
}

export interface TSNEOptions {
  dim: number;
  perplexity?: number;
  epsilon?: number;
  rng?: () => number;
  seed?: number;
}

export class TSNE {
  private perplexity: number;
  private epsilon: number;
  private rng: () => number;
  private iter = 0;
  private Y!: Float64Array;
  private N!: number;
  private P!: Float64Array;
  private gains!: number[][];
  private ystep!: number[][];
  private nearest!: { index: number; dist: number }[][];
  private dim: number;
  private dist2Fn: (a: number[], b: number[]) => number;
  private computeForce: (force: number[], mult: number, pointA: number[], pointB: number[]) => void;

  constructor(opt: TSNEOptions) {
    this.perplexity = opt.perplexity || 30;
    this.epsilon = opt.epsilon || 10;
    // Use provided rng, or create seeded random if seed provided, or fallback to Math.random
    this.rng = opt.rng || (opt.seed != null ? createSeededRandom(opt.seed) : Math.random);
    this.dim = opt.dim;

    if (opt.dim === 2) {
      this.dist2Fn = dist2_2D;
      this.computeForce = computeForce_2d;
    } else if (opt.dim === 3) {
      this.dist2Fn = dist2_3D;
      this.computeForce = computeForce_3d;
    } else {
      throw new Error('Only 2D and 3D is supported');
    }
  }

  initDataDist(nearest: { index: number; dist: number }[][]) {
    const N = nearest.length;
    this.nearest = nearest;
    this.P = nearest2P(nearest, this.perplexity, 0.0001);
    this.N = N;
    this.initSolution();
  }

  initSolution() {
    if (!this.Y) {
      this.Y = randnMatrix(this.N, this.dim, this.rng);
    }
    this.gains = arrayofs(this.N, this.dim, 1);
    this.ystep = arrayofs(this.N, this.dim, 0);
    this.iter = 0;
  }

  getDim() {
    return this.dim;
  }

  getSolution() {
    return this.Y;
  }

  setSolution(solution: Float64Array) {
    this.Y = solution;
  }

  setEpsilon(epsilon: number) {
    this.epsilon = epsilon;
  }

  step() {
    this.iter += 1;
    const N = this.N;
    const grad = this.costGrad(this.Y);
    const ymean = this.dim === 3 ? [0, 0, 0] : [0, 0];

    for (let i = 0; i < N; ++i) {
      for (let d = 0; d < this.dim; ++d) {
        const gid = grad[i][d];
        const sid = this.ystep[i][d];
        const gainid = this.gains[i][d];

        let newgain = sign(gid) === sign(sid) ? gainid * 0.8 : gainid + 0.2;
        if (newgain < 0.01) newgain = 0.01;
        this.gains[i][d] = newgain;

        const momval = this.iter < 250 ? 0.5 : 0.8;
        const newsid = momval * sid - this.epsilon * newgain * grad[i][d];
        this.ystep[i][d] = newsid;

        const i_d = i * this.dim + d;
        this.Y[i_d] += newsid;
        ymean[d] += this.Y[i_d];
      }
    }

    for (let i = 0; i < N; ++i) {
      for (let d = 0; d < this.dim; ++d) {
        this.Y[i * this.dim + d] -= ymean[d] / N;
      }
    }
  }

  private costGrad(Y: Float64Array): number[][] {
    const N = this.N;
    const P = this.P;
    const alpha = this.iter < 100 ? 4 : 1;

    const points: number[][] = new Array(N);
    for (let i = 0; i < N; ++i) {
      const iTimesD = i * this.dim;
      const row = new Array(this.dim);
      for (let d = 0; d < this.dim; ++d) {
        row[d] = Y[iTimesD + d];
      }
      points[i] = row;
    }

    const tree = new SPTree(points);
    const root = tree.root as AugmSPNode;

    const annotateTree = (node: AugmSPNode): { numCells: number; yCell: number[] } => {
      let numCells = 1;
      if (node.children == null) {
        node.numCells = numCells;
        node.yCell = node.point;
        return { numCells, yCell: node.yCell };
      }
      const yCell = node.point.slice();
      for (let i = 0; i < node.children.length; ++i) {
        const child = node.children[i];
        if (child == null) continue;
        const result = annotateTree(child as AugmSPNode);
        numCells += result.numCells;
        for (let d = 0; d < this.dim; ++d) {
          yCell[d] += result.yCell[d];
        }
      }
      node.numCells = numCells;
      node.yCell = yCell.map((v) => v / numCells);
      return { numCells, yCell };
    };

    annotateTree(root);
    tree.visit((node: SPNode, low?: number[], high?: number[]) => {
      (node as AugmSPNode).rCell = high![0] - low![0];
      return false;
    });

    const grad: number[][] = [];
    let Z = 0;
    const forces: [number[], number[]][] = new Array(N);

    for (let i = 0; i < N; ++i) {
      const pointI = points[i];
      const Fpos = this.dim === 3 ? [0, 0, 0] : [0, 0];
      const neighbors = this.nearest[i];

      for (let k = 0; k < neighbors.length; ++k) {
        const j = neighbors[k].index;
        const pij = P[i * N + j];
        const pointJ = points[j];
        const squaredDistItoJ = this.dist2Fn(pointI, pointJ);
        const premult = pij / (1 + squaredDistItoJ);
        this.computeForce(Fpos, premult, pointI, pointJ);
      }

      const FnegZ = this.dim === 3 ? [0, 0, 0] : [0, 0];
      tree.visit((node: SPNode) => {
        const augNode = node as AugmSPNode;
        const squaredDistToCell = this.dist2Fn(pointI, augNode.yCell);

        if (
          node.children == null ||
          (squaredDistToCell > 0 && augNode.rCell / Math.sqrt(squaredDistToCell) < THETA)
        ) {
          let qijZ = 1 / (1 + squaredDistToCell);
          let dZ = augNode.numCells * qijZ;
          Z += dZ;
          dZ *= qijZ;
          this.computeForce(FnegZ, dZ, pointI, augNode.yCell);
          return true;
        }

        const squaredDistToPoint = this.dist2Fn(pointI, node.point);
        let qijZ = 1 / (1 + squaredDistToPoint);
        Z += qijZ;
        qijZ *= qijZ;
        this.computeForce(FnegZ, qijZ, pointI, node.point);
        return false;
      }, true);

      forces[i] = [Fpos, FnegZ];
    }

    const A = 4 * alpha;
    const B = 4 / Z;
    for (let i = 0; i < N; ++i) {
      const [FPos, FNegZ] = forces[i];
      const gsum = new Array(this.dim);
      for (let d = 0; d < this.dim; ++d) {
        gsum[d] = A * FPos[d] - B * FNegZ[d];
      }
      grad.push(gsum);
    }

    return grad;
  }
}

/** Compute KNN for t-SNE initialization */
export function computeKNN(
  data: number[][],
  k: number
): { index: number; dist: number }[][] {
  const N = data.length;
  const nearest: { index: number; dist: number }[][] = new Array(N);

  for (let i = 0; i < N; ++i) {
    const distances: { index: number; dist: number }[] = [];
    for (let j = 0; j < N; ++j) {
      if (i !== j) {
        distances.push({ index: j, dist: dist2(data[i], data[j]) });
      }
    }
    distances.sort((a, b) => a.dist - b.dist);
    nearest[i] = distances.slice(0, k);
  }

  return nearest;
}
