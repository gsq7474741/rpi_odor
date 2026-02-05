/**
 * Space-partitioning tree for Barnes-Hut t-SNE approximation.
 * Adapted from TensorBoard Embedding Projector.
 * 
 * @license Apache-2.0
 * Copyright 2016 The TensorFlow Authors. All Rights Reserved.
 */

export type Point = number[];

export interface BBox {
  center: Point;
  halfDim: number;
}

/** A node in a space-partitioning tree. */
export interface SPNode {
  /** The children of this node. */
  children: SPNode[];
  /** The bounding box of the region this node occupies. */
  box: BBox;
  /** One or more points this node has. */
  point: Point;
}

/**
 * A Space-partitioning tree that recursively divides the space into regions
 * of equal sizes. This data structure can act both as a Quad tree and an
 * Octree when the data is 2 or 3 dimensional respectively.
 */
export class SPTree {
  root: SPNode;
  private masks: number[];
  private dim: number;

  constructor(data: Point[]) {
    if (data.length < 1) {
      throw new Error('There should be at least 1 data point');
    }
    this.dim = data[0].length;
    this.masks = new Array(Math.pow(2, this.dim));
    for (let d = 0; d < this.masks.length; ++d) {
      this.masks[d] = 1 << d;
    }

    const min: Point = new Array(this.dim).fill(Number.POSITIVE_INFINITY);
    const max: Point = new Array(this.dim).fill(Number.NEGATIVE_INFINITY);

    for (let i = 0; i < data.length; ++i) {
      for (let d = 0; d < this.dim; ++d) {
        min[d] = Math.min(min[d], data[i][d]);
        max[d] = Math.max(max[d], data[i][d]);
      }
    }

    const center: Point = new Array(this.dim);
    let halfDim = 0;
    for (let d = 0; d < this.dim; ++d) {
      const span = max[d] - min[d];
      center[d] = min[d] + span / 2;
      halfDim = Math.max(halfDim, span / 2);
    }

    this.root = {
      children: [],
      box: { center, halfDim },
      point: data[0],
    };

    for (let i = 1; i < data.length; ++i) {
      this.insert(this.root, data[i]);
    }
  }

  visit(
    accessor: (node: SPNode, lowPoint?: Point, highPoint?: Point) => boolean,
    noBox = false
  ) {
    this.visitNode(this.root, accessor, noBox);
  }

  private visitNode(
    node: SPNode,
    accessor: (node: SPNode, lowPoint?: Point, highPoint?: Point) => boolean,
    noBox: boolean
  ) {
    let skipChildren: boolean;
    if (noBox) {
      skipChildren = accessor(node);
    } else {
      const lowPoint = new Array(this.dim);
      const highPoint = new Array(this.dim);
      for (let d = 0; d < this.dim; ++d) {
        lowPoint[d] = node.box.center[d] - node.box.halfDim;
        highPoint[d] = node.box.center[d] + node.box.halfDim;
      }
      skipChildren = accessor(node, lowPoint, highPoint);
    }
    if (!node.children || skipChildren) {
      return;
    }
    for (let i = 0; i < node.children.length; ++i) {
      const child = node.children[i];
      if (child) {
        this.visitNode(child, accessor, noBox);
      }
    }
  }

  private insert(node: SPNode, p: Point) {
    if (node.children == null) {
      node.children = new Array(this.masks.length);
    }
    let index = 0;
    for (let d = 0; d < this.dim; ++d) {
      if (p[d] > node.box.center[d]) {
        index |= this.masks[d];
      }
    }
    if (node.children[index] == null) {
      this.makeChild(node, index, p);
    } else {
      this.insert(node.children[index], p);
    }
  }

  private makeChild(node: SPNode, index: number, p: Point): void {
    const oldC = node.box.center;
    const h = node.box.halfDim / 2;
    const newC: Point = new Array(this.dim);
    for (let d = 0; d < this.dim; ++d) {
      newC[d] = index & (1 << d) ? oldC[d] + h : oldC[d] - h;
    }
    node.children[index] = {
      children: [],
      box: { center: newC, halfDim: h },
      point: p,
    };
  }
}
