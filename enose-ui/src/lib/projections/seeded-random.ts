/**
 * Seeded random number generator for reproducible projections.
 * Uses seedrandom library to ensure same seed produces same sequence.
 */

import seedrandom from 'seedrandom';

export type RandomGenerator = () => number;

/**
 * Create a seeded random number generator.
 * Same seed will always produce the same sequence of numbers.
 */
export function createSeededRandom(seed?: number | string): RandomGenerator {
  if (seed === undefined) {
    // Use current timestamp as default seed
    seed = Date.now();
  }
  return seedrandom(String(seed));
}

/**
 * Fisher-Yates shuffle using a seeded random generator.
 * Returns a new shuffled array without modifying the original.
 */
export function seededShuffle<T>(array: T[], rng: RandomGenerator): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Generate a range of numbers [0, 1, 2, ..., count-1].
 */
export function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

/**
 * Sample n items from array using seeded random.
 */
export function seededSample<T>(array: T[], n: number, rng: RandomGenerator): T[] {
  const shuffled = seededShuffle(array, rng);
  return shuffled.slice(0, Math.min(n, array.length));
}

/**
 * Generate random indices for sampling.
 * Returns shuffled indices that can be reused for consistent sampling.
 */
export function generateShuffledIndices(length: number, rng: RandomGenerator): number[] {
  return seededShuffle(range(length), rng);
}
