/* Copyright 2016 The TensorFlow Authors. All Rights Reserved.
   Adapted for enose-ui project */

import * as THREE from 'three';
import { RenderContext } from './renderContext';

/**
 * ScatterPlotVisualizer is an interface used by ScatterPlot to manage
 * separate visualizers for different parts of the scatter plot (e.g. sprites,
 * labels, polylines, etc).
 */
export interface ScatterPlotVisualizer {
  /** Called to initialize the visualizer with a reference to the scene. */
  setScene(scene: THREE.Scene): void;

  /** Called when the scatter plot's data changes and we need to redraw. */
  onPointPositionsChanged(newPositions: Float32Array): void;

  /** Called when the container is resized. */
  onResize(newWidth: number, newHeight: number): void;

  /**
   * Called just before rendering for picking (selection). Allows for picking
   * objects to be prepared.
   */
  onPickingRender(renderContext: RenderContext): void;

  /**
   * Called just before the main scene is rendered. Allows for scene objects
   * to be prepared.
   */
  onRender(renderContext: RenderContext): void;

  /** Called when the background color changes (for dark mode support). */
  onBackgroundColorChanged?(color: number): void;

  /** Called to clean up any resources. */
  dispose(): void;
}
