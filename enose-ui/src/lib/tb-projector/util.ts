/* Copyright 2016 The TensorFlow Authors. All Rights Reserved.
   Adapted for enose-ui project */

import * as THREE from 'three';
import * as vector from './vector';

/** Shuffles the array in-place in O(n) time using Fisher-Yates algorithm. */
export function shuffle<T>(array: T[], seed?: number): T[] {
  const random = seed !== undefined ? seededRandom(seed) : Math.random;
  let m = array.length;
  let t: T;
  let i: number;
  while (m) {
    i = Math.floor(random() * m--);
    t = array[m];
    array[m] = array[i];
    array[i] = t;
  }
  return array;
}

/** Creates a seeded random number generator */
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export function range(count: number): number[] {
  const rangeOutput: number[] = [];
  for (let i = 0; i < count; i++) {
    rangeOutput.push(i);
  }
  return rangeOutput;
}

export function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

/** Projects a 3d point into screen space */
export function vector3DToScreenCoords(
  cam: THREE.Camera,
  w: number,
  h: number,
  v: THREE.Vector3
): vector.Point2D {
  const dpr = window.devicePixelRatio;
  const pv = new THREE.Vector3().copy(v).project(cam);
  const coords: vector.Point2D = [
    ((pv.x + 1) / 2) * w * dpr,
    -(((pv.y - 1) / 2) * h) * dpr,
  ];
  return coords;
}

/** Loads 3 contiguous elements from a packed xyz array into a Vector3. */
export function vector3FromPackedArray(
  a: Float32Array,
  pointIndex: number
): THREE.Vector3 {
  const offset = pointIndex * 3;
  return new THREE.Vector3(a[offset], a[offset + 1], a[offset + 2]);
}

/**
 * Gets the camera-space z coordinates of the nearest and farthest points.
 * Ignores points that are behind the camera.
 */
export function getNearFarPoints(
  worldSpacePoints: Float32Array,
  cameraPos: THREE.Vector3,
  cameraTarget: THREE.Vector3
): [number, number] {
  let shortestDist: number = Infinity;
  let furthestDist: number = 0;
  const camToTarget = new THREE.Vector3().copy(cameraTarget).sub(cameraPos);
  const nPoints = worldSpacePoints.length / 3;
  for (let i = 0; i < nPoints; i++) {
    const point = vector3FromPackedArray(worldSpacePoints, i);
    const camToPoint = new THREE.Vector3().copy(point).sub(cameraPos);
    const dist = camToTarget.dot(camToPoint);
    if (dist < 0) {
      continue;
    }
    if (dist < shortestDist) {
      shortestDist = dist;
    }
    if (dist > furthestDist) {
      furthestDist = dist;
    }
  }
  return [shortestDist, furthestDist];
}

/** Generates a random color */
export function getDefaultPointInPolylineColor(
  index: number,
  totalPoints: number
): THREE.Color {
  const hue = index / totalPoints;
  return new THREE.Color().setHSL(hue, 1, 0.5);
}

/** Packs RGB color components into a Float32 */
export function packRgbIntoUint8Array(
  rgbArray: Uint8Array,
  labelIndex: number,
  r: number,
  g: number,
  b: number
) {
  rgbArray[labelIndex * 3] = r;
  rgbArray[labelIndex * 3 + 1] = g;
  rgbArray[labelIndex * 3 + 2] = b;
}

/** Styles for rendering */
export const SCATTER_PLOT_CUBE_LENGTH = 2;
