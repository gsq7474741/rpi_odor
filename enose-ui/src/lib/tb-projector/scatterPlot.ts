/* Copyright 2016 The TensorFlow Authors. All Rights Reserved.
   Adapted for enose-ui project */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CameraType, LabelRenderParams, RenderContext } from './renderContext';
import { ScatterPlotVisualizer } from './scatterPlotVisualizer';
import * as util from './util';
import * as vector from './vector';

const BACKGROUND_COLOR = 0xffffff;
const CUBE_LENGTH = 2;
const MAX_ZOOM = 5 * CUBE_LENGTH;
const MIN_ZOOM = 0.025 * CUBE_LENGTH;
const PERSP_CAMERA_FOV_VERTICAL = 70;
const PERSP_CAMERA_NEAR_CLIP_PLANE = 0.01;
const PERSP_CAMERA_FAR_CLIP_PLANE = 100;
const ORTHO_CAMERA_FRUSTUM_HALF_EXTENT = 1.2;
const ORBIT_MOUSE_ROTATION_SPEED = 1;
const ORBIT_ANIMATION_ROTATION_CYCLE_IN_SECONDS = 2;

export type OnCameraMoveListener = (
  cameraPosition: THREE.Vector3,
  cameraTarget: THREE.Vector3
) => void;

export enum MouseMode {
  AREA_SELECT,
  CAMERA_AND_CLICK_SELECT,
}

export class CameraDef {
  orthographic: boolean = false;
  position: vector.Point3D = [0, 0, 0];
  target: vector.Point3D = [0, 0, 0];
  zoom: number = 1;
}

export interface ScatterPlotParams {
  onHover?: (pointIndex: number | null) => void;
  onClick?: (pointIndices: number[]) => void;
  onSelect?: (pointIndices: number[]) => void;
}

/**
 * Maintains a three.js instantiation and context,
 * animation state, and all other logic that's
 * independent of how a 3D scatter plot is actually rendered.
 */
export class ScatterPlot {
  private readonly START_CAMERA_POS_3D = new THREE.Vector3(0.8, 1.5, 3.0);
  private readonly START_CAMERA_TARGET_3D = new THREE.Vector3(0, 0, 0);
  private readonly START_CAMERA_POS_2D = new THREE.Vector3(0, 0, 4);
  private readonly START_CAMERA_TARGET_2D = new THREE.Vector3(0, 0, 0);

  private visualizers: ScatterPlotVisualizer[] = [];
  private onCameraMoveListeners: OnCameraMoveListener[] = [];
  private height: number = 0;
  private width: number = 0;
  private mouseMode: MouseMode = MouseMode.CAMERA_AND_CLICK_SELECT;
  private backgroundColor: number = BACKGROUND_COLOR;
  private dimensionality: number = 3;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private pickingTexture: THREE.WebGLRenderTarget | null = null;
  private light: THREE.PointLight;
  private cameraDef: CameraDef | null = null;
  private camera!: THREE.Camera;
  private orbitAnimationOnNextCameraCreation: boolean = false;
  private orbitCameraControls: OrbitControls | null = null;
  private orbitAnimationId: number | null = null;
  private worldSpacePointPositions: Float32Array = new Float32Array(0);
  private pointColors: Float32Array = new Float32Array(0);
  private pointScaleFactors: Float32Array = new Float32Array(0);
  private labels: LabelRenderParams | null = null;
  private polylineColors: { [polylineIndex: number]: Float32Array } = {};
  private polylineOpacities: Float32Array = new Float32Array(0);
  private polylineWidths: Float32Array = new Float32Array(0);
  private selecting = false;
  private nearestPoint: number | null = null;
  private mouseIsDown = false;
  private isDragSequence = false;
  private hoverCallback?: (pointIndex: number | null) => void;
  private clickCallback?: (pointIndices: number[]) => void;
  private disposed = false;
  private axesHelper: THREE.AxesHelper | null = null;

  constructor(
    private container: HTMLElement,
    params?: ScatterPlotParams
  ) {
    this.hoverCallback = params?.onHover;
    this.clickCallback = params?.onClick;

    this.getLayoutValues();
    this.scene = new THREE.Scene();
    
    // Create renderer with explicit context attributes for WebGL stability
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true, // Important for stable picking
    });
    this.renderer.setClearColor(BACKGROUND_COLOR, 1);
    this.container.appendChild(this.renderer.domElement);
    
    this.light = new THREE.PointLight(0xffecbf, 1, 0);
    this.scene.add(this.light);
    
    // Initialize with 3D dimensions (will be changed by caller if needed)
    this.setDimensions(3);
    this.renderer.render(this.scene, this.camera);
    
    this.addInteractionListeners();
  }

  private addInteractionListeners() {
    this.container.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.container.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.container.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.container.addEventListener('click', this.onClick.bind(this));
  }

  private addCameraControlsEventListeners(cameraControls: OrbitControls) {
    cameraControls.addEventListener('start', () => {
      this.stopOrbitAnimation();
      this.onCameraMoveListeners.forEach((l) =>
        l(this.camera.position, cameraControls.target)
      );
    });
    cameraControls.addEventListener('change', () => {
      this.render();
    });
  }

  private makeOrbitControls(
    camera: THREE.Camera,
    cameraDef: CameraDef,
    cameraIs3D: boolean
  ) {
    if (this.orbitCameraControls != null) {
      this.orbitCameraControls.dispose();
    }
    const occ = new OrbitControls(camera, this.renderer.domElement);
    occ.target.set(cameraDef.target[0], cameraDef.target[1], cameraDef.target[2]);
    occ.enableRotate = cameraIs3D;
    occ.rotateSpeed = ORBIT_MOUSE_ROTATION_SPEED;
    if (cameraIs3D) {
      occ.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
    } else {
      occ.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
    }
    occ.update();
    this.camera = camera;
    this.orbitCameraControls = occ;
    this.addCameraControlsEventListeners(this.orbitCameraControls);
  }

  private makeCamera3D(cameraDef: CameraDef, w: number, h: number) {
    const aspectRatio = w / h;
    const camera = new THREE.PerspectiveCamera(
      PERSP_CAMERA_FOV_VERTICAL,
      aspectRatio,
      PERSP_CAMERA_NEAR_CLIP_PLANE,
      PERSP_CAMERA_FAR_CLIP_PLANE
    );
    camera.position.set(
      cameraDef.position[0],
      cameraDef.position[1],
      cameraDef.position[2]
    );
    const at = new THREE.Vector3(
      cameraDef.target[0],
      cameraDef.target[1],
      cameraDef.target[2]
    );
    camera.lookAt(at);
    camera.zoom = cameraDef.zoom;
    camera.updateProjectionMatrix();
    this.camera = camera;
    this.makeOrbitControls(camera, cameraDef, true);
  }

  private makeCamera2D(cameraDef: CameraDef, w: number, h: number) {
    const target = new THREE.Vector3(
      cameraDef.target[0],
      cameraDef.target[1],
      cameraDef.target[2]
    );
    const aspectRatio = w / h;
    let left = -ORTHO_CAMERA_FRUSTUM_HALF_EXTENT;
    let right = ORTHO_CAMERA_FRUSTUM_HALF_EXTENT;
    let bottom = -ORTHO_CAMERA_FRUSTUM_HALF_EXTENT;
    let top = ORTHO_CAMERA_FRUSTUM_HALF_EXTENT;
    if (aspectRatio > 1) {
      left *= aspectRatio;
      right *= aspectRatio;
    } else {
      top /= aspectRatio;
      bottom /= aspectRatio;
    }
    const camera = new THREE.OrthographicCamera(
      left,
      right,
      top,
      bottom,
      -1000,
      1000
    );
    camera.position.set(
      cameraDef.position[0],
      cameraDef.position[1],
      cameraDef.position[2]
    );
    camera.up = new THREE.Vector3(0, 1, 0);
    camera.lookAt(target);
    camera.zoom = cameraDef.zoom;
    camera.updateProjectionMatrix();
    this.camera = camera;
    this.makeOrbitControls(camera, cameraDef, false);
  }

  private makeDefaultCameraDef(dimensionality: number): CameraDef {
    const def = new CameraDef();
    def.orthographic = dimensionality === 2;
    def.zoom = 1;
    if (dimensionality === 3) {
      def.position = [
        this.START_CAMERA_POS_3D.x,
        this.START_CAMERA_POS_3D.y,
        this.START_CAMERA_POS_3D.z,
      ];
      def.target = [
        this.START_CAMERA_TARGET_3D.x,
        this.START_CAMERA_TARGET_3D.y,
        this.START_CAMERA_TARGET_3D.z,
      ];
    } else {
      def.position = [
        this.START_CAMERA_POS_2D.x,
        this.START_CAMERA_POS_2D.y,
        this.START_CAMERA_POS_2D.z,
      ];
      def.target = [
        this.START_CAMERA_TARGET_2D.x,
        this.START_CAMERA_TARGET_2D.y,
        this.START_CAMERA_TARGET_2D.z,
      ];
    }
    return def;
  }

  private recreateCamera(cameraDef: CameraDef) {
    if (cameraDef.orthographic) {
      this.makeCamera2D(cameraDef, this.width, this.height);
    } else {
      this.makeCamera3D(cameraDef, this.width, this.height);
    }
    this.orbitCameraControls?.update();
    if (this.orbitAnimationOnNextCameraCreation) {
      this.startOrbitAnimation();
    }
  }

  private onClick(e?: MouseEvent, shouldThrottle = true) {
    if (this.isDragSequence) {
      this.isDragSequence = false;
      return;
    }
    if (this.nearestPoint != null) {
      this.clickCallback?.([this.nearestPoint]);
    }
  }

  private onMouseDown(e: MouseEvent) {
    this.mouseIsDown = true;
    this.isDragSequence = false;
  }

  private onMouseUp(e: MouseEvent) {
    this.mouseIsDown = false;
  }

  private onMouseMove(e: MouseEvent) {
    if (this.mouseIsDown) {
      this.isDragSequence = true;
    }
    this.setNearestPointToMouse(e);
  }

  private setNearestPointToMouse(e: MouseEvent) {
    if (this.pickingTexture == null) {
      this.nearestPoint = null;
      return;
    }

    const boundingBox = this.container.getBoundingClientRect();
    const x = e.clientX - boundingBox.left;
    const y = e.clientY - boundingBox.top;
    const dpr = window.devicePixelRatio || 1;
    const xPicking = x * dpr;
    const yPicking = (this.height - y) * dpr;

    const pixelBuffer = new Uint8Array(4);
    
    try {
      this.renderer.readRenderTargetPixels(
        this.pickingTexture,
        Math.floor(xPicking),
        Math.floor(yPicking),
        1,
        1,
        pixelBuffer
      );
    } catch (err) {
      // WebGL readPixels can fail in certain conditions
      console.warn('readRenderTargetPixels failed:', err);
      this.nearestPoint = null;
      this.hoverCallback?.(null);
      return;
    }

    if (pixelBuffer[3] === 0) {
      this.nearestPoint = null;
    } else {
      this.nearestPoint =
        pixelBuffer[0] + pixelBuffer[1] * 256 + pixelBuffer[2] * 256 * 256;
    }
    this.hoverCallback?.(this.nearestPoint);
  }

  private getLayoutValues(): [number, number] {
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    return [this.width, this.height];
  }

  setDimensions(nDimensions: number) {
    // Always create a new default camera when dimensions change
    const cameraDef = this.makeDefaultCameraDef(nDimensions);
    this.cameraDef = cameraDef;
    this.dimensionality = nDimensions;
    this.recreateCamera(cameraDef);
    
    // Add/remove 3D axes helper
    if (nDimensions === 3) {
      if (!this.axesHelper) {
        this.axesHelper = new THREE.AxesHelper(1.2);
        this.scene.add(this.axesHelper);
      }
    } else {
      if (this.axesHelper) {
        this.scene.remove(this.axesHelper);
        this.axesHelper.dispose();
        this.axesHelper = null;
      }
    }
  }

  /** Gets the current camera position. */
  getCameraPosition(): vector.Point3D {
    const currPos = this.camera.position;
    return [currPos.x, currPos.y, currPos.z];
  }

  /** Gets the current camera target. */
  getCameraTarget(): vector.Point3D {
    const currTarget = this.orbitCameraControls?.target ?? new THREE.Vector3();
    return [currTarget.x, currTarget.y, currTarget.z];
  }

  /** Starts orbiting the camera around its current lookat target. */
  startOrbitAnimation() {
    if (!this.sceneIs3D()) {
      return;
    }
    if (this.orbitAnimationId != null) {
      this.stopOrbitAnimation();
    }
    if (this.orbitCameraControls) {
      this.orbitCameraControls.autoRotate = true;
      this.orbitCameraControls.autoRotateSpeed = ORBIT_ANIMATION_ROTATION_CYCLE_IN_SECONDS;
    }
    this.updateOrbitAnimation();
  }

  private updateOrbitAnimation() {
    this.orbitCameraControls?.update();
    this.render();
    this.orbitAnimationId = requestAnimationFrame(() =>
      this.updateOrbitAnimation()
    );
  }

  /** Stops the orbiting animation on the camera. */
  stopOrbitAnimation() {
    if (this.orbitCameraControls) {
      this.orbitCameraControls.autoRotate = false;
    }
    if (this.orbitAnimationId != null) {
      cancelAnimationFrame(this.orbitAnimationId);
      this.orbitAnimationId = null;
    }
  }

  sceneIs3D(): boolean {
    return this.dimensionality === 3;
  }

  /** Adds a visualizer to the set, will start dispatching events to it */
  addVisualizer(visualizer: ScatterPlotVisualizer) {
    if (this.scene) {
      visualizer.setScene(this.scene);
    }
    visualizer.onResize(this.width, this.height);
    visualizer.onPointPositionsChanged(this.worldSpacePointPositions);
    this.visualizers.push(visualizer);
  }

  /** Removes all visualizers attached to this scatter plot. */
  removeAllVisualizers() {
    this.visualizers.forEach((v) => v.dispose());
    this.visualizers = [];
  }

  /** Update scatter plot with a new array of packed xyz point positions. */
  setPointPositions(worldSpacePointPositions: Float32Array) {
    this.worldSpacePointPositions = worldSpacePointPositions;
    this.visualizers.forEach((v) =>
      v.onPointPositionsChanged(worldSpacePointPositions)
    );
  }

  render() {
    if (this.disposed) return;
    
    const lightPos = this.camera.position.clone();
    lightPos.x += 1;
    lightPos.y += 1;
    this.light.position.set(lightPos.x, lightPos.y, lightPos.z);

    const cameraType =
      this.camera instanceof THREE.PerspectiveCamera
        ? CameraType.Perspective
        : CameraType.Orthographic;
    
    let cameraSpacePointExtents: [number, number] = [0, 0];
    if (this.worldSpacePointPositions != null && this.worldSpacePointPositions.length > 0) {
      cameraSpacePointExtents = util.getNearFarPoints(
        this.worldSpacePointPositions,
        this.camera.position,
        this.orbitCameraControls?.target ?? new THREE.Vector3()
      );
    }

    const rc = new RenderContext(
      this.camera,
      cameraType,
      this.orbitCameraControls?.target ?? new THREE.Vector3(),
      this.width,
      this.height,
      cameraSpacePointExtents[0],
      cameraSpacePointExtents[1],
      this.backgroundColor,
      this.pointColors,
      this.pointScaleFactors,
      this.labels,
      this.polylineColors,
      this.polylineOpacities,
      this.polylineWidths
    );

    // Render first pass to picking target
    this.visualizers.forEach((v) => v.onPickingRender(rc));
    
    if (this.pickingTexture) {
      try {
        this.renderer.setRenderTarget(this.pickingTexture);
        this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(null);
      } catch (err) {
        console.warn('Picking render failed:', err);
      }
    }

    // Render second pass to color buffer
    this.visualizers.forEach((v) => v.onRender(rc));
    this.renderer.render(this.scene, this.camera);
  }

  /** Set the colors for every data point. (RGB triplets) */
  setPointColors(colors: Float32Array) {
    this.pointColors = colors;
  }

  /** Set the scale factors for every data point. (scalars) */
  setPointScaleFactors(scaleFactors: Float32Array) {
    this.pointScaleFactors = scaleFactors;
  }

  resetZoom() {
    this.recreateCamera(this.makeDefaultCameraDef(this.dimensionality));
    this.render();
  }

  resize(doRender = true) {
    const [oldW, oldH] = [this.width, this.height];
    const [newW, newH] = this.getLayoutValues();
    
    if (newW === 0 || newH === 0) return;

    // If old dimensions were 0, recreate camera with proper defaults
    if (oldW === 0 || oldH === 0) {
      this.recreateCamera(this.makeDefaultCameraDef(this.dimensionality));
    } else if (this.dimensionality === 3) {
      const camera = this.camera as THREE.PerspectiveCamera;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
    } else {
      const camera = this.camera as THREE.OrthographicCamera;
      const scaleW = newW / oldW;
      const scaleH = newH / oldH;
      const newCamHalfWidth = ((camera.right - camera.left) * scaleW) / 2;
      const newCamHalfHeight = ((camera.top - camera.bottom) * scaleH) / 2;
      camera.top = newCamHalfHeight;
      camera.bottom = -newCamHalfHeight;
      camera.left = -newCamHalfWidth;
      camera.right = newCamHalfWidth;
      camera.updateProjectionMatrix();
    }

    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(newW, newH);

    // Recreate picking texture with correct dimensions
    const renderCanvasSize = new THREE.Vector2();
    this.renderer.getSize(renderCanvasSize);
    const pixelRatio = this.renderer.getPixelRatio();
    
    // Dispose old picking texture
    if (this.pickingTexture) {
      this.pickingTexture.dispose();
    }
    
    this.pickingTexture = new THREE.WebGLRenderTarget(
      renderCanvasSize.width * pixelRatio,
      renderCanvasSize.height * pixelRatio
    );
    this.pickingTexture.texture.minFilter = THREE.LinearFilter;

    this.visualizers.forEach((v) => v.onResize(newW, newH));
    
    if (doRender) {
      this.render();
    }
  }

  onCameraMove(listener: OnCameraMoveListener) {
    this.onCameraMoveListeners.push(listener);
  }

  dispose() {
    this.disposed = true;
    this.stopOrbitAnimation();
    this.removeAllVisualizers();
    this.orbitCameraControls?.dispose();
    this.pickingTexture?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
