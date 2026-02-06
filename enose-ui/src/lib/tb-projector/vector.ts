/* Copyright 2016 The TensorFlow Authors. All Rights Reserved.
   Adapted for enose-ui project */

export type Vector = Float32Array | number[];
export type Point2D = [number, number];
export type Point3D = [number, number, number];

/** Returns the dot product of two vectors. */
export function dot(a: Vector, b: Vector): number {
  let result = 0;
  for (let i = 0; i < a.length; ++i) {
    result += a[i] * b[i];
  }
  return result;
}

/** Sums all the elements in the vector */
export function sum(a: Vector): number {
  let result = 0;
  for (let i = 0; i < a.length; ++i) {
    result += a[i];
  }
  return result;
}

/** Returns the sum of two vectors, i.e. a + b */
export function add(a: Vector, b: Vector): Float32Array {
  const result = new Float32Array(a.length);
  for (let i = 0; i < a.length; ++i) {
    result[i] = a[i] + b[i];
  }
  return result;
}

/** Subtracts vector b from vector a, i.e. returns a - b */
export function sub(a: Vector, b: Vector): Float32Array {
  const result = new Float32Array(a.length);
  for (let i = 0; i < a.length; ++i) {
    result[i] = a[i] - b[i];
  }
  return result;
}

/** Returns the square norm of the vector */
export function norm2(a: Vector): number {
  let result = 0;
  for (let i = 0; i < a.length; ++i) {
    result += a[i] * a[i];
  }
  return result;
}

/** Returns the euclidean distance between two vectors. */
export function dist(a: Vector, b: Vector): number {
  return Math.sqrt(dist2(a, b));
}

/** Returns the square euclidean distance between two vectors. */
export function dist2(a: Vector, b: Vector): number {
  let result = 0;
  for (let i = 0; i < a.length; ++i) {
    const diff = a[i] - b[i];
    result += diff * diff;
  }
  return result;
}

/** Normalizes the vector to unit length */
export function unit(a: Vector): Float32Array {
  const length = Math.sqrt(norm2(a));
  const result = new Float32Array(a.length);
  for (let i = 0; i < a.length; ++i) {
    result[i] = a[i] / length;
  }
  return result;
}

/** Scales a vector by a scalar */
export function scale(a: Vector, k: number): Float32Array {
  const result = new Float32Array(a.length);
  for (let i = 0; i < a.length; ++i) {
    result[i] = a[i] * k;
  }
  return result;
}

/** Projects point b onto vector a */
export function project(a: Vector, b: Vector): Float32Array {
  const scalar = dot(a, b) / norm2(a);
  return scale(a, scalar);
}

/** Returns the mean of a list of vectors */
export function mean(vectors: Vector[]): Float32Array {
  if (vectors.length === 0) {
    return new Float32Array(0);
  }
  const result = new Float32Array(vectors[0].length);
  for (const v of vectors) {
    for (let i = 0; i < v.length; ++i) {
      result[i] += v[i];
    }
  }
  for (let i = 0; i < result.length; ++i) {
    result[i] /= vectors.length;
  }
  return result;
}
