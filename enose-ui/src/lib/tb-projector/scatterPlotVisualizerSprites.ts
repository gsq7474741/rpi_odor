/* Copyright 2016 The TensorFlow Authors. All Rights Reserved.
   Adapted for enose-ui project */

import * as THREE from 'three';
import { CameraType, RenderContext } from './renderContext';
import { ScatterPlotVisualizer } from './scatterPlotVisualizer';

const NUM_POINTS_FOG_THRESHOLD = 5000;
const MIN_POINT_SIZE = 2;
const RGB_NUM_ELEMENTS = 3;
const INDEX_NUM_ELEMENTS = 1;
const XYZ_NUM_ELEMENTS = 3;

function createVertexShader() {
  return `
  attribute float spriteIndex;
  attribute vec3 color;
  attribute float scaleFactor;

  varying vec2 xyIndex;
  varying vec3 vColor;

  uniform bool sizeAttenuation;
  uniform float pointSize;
  uniform float spritesPerRow;
  uniform float spritesPerColumn;

  ${THREE.ShaderChunk['fog_pars_vertex']}

  void main() {
    vColor = color;
    xyIndex = vec2(mod(spriteIndex, spritesPerRow),
              floor(spriteIndex / spritesPerColumn));

    vec4 cameraSpacePos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * cameraSpacePos;

    float outputPointSize = pointSize;
    if (sizeAttenuation) {
      outputPointSize = -pointSize / cameraSpacePos.z;
    } else {
      const float PI = 3.1415926535897932384626433832795;
      const float minScale = 0.1;
      const float outSpeed = 2.0;
      const float outNorm = (1. - minScale) / atan(outSpeed);
      const float maxScale = 15.0;
      const float inSpeed = 0.02;
      const float zoomOffset = 0.3;
      float zoom = projectionMatrix[0][0] + zoomOffset;
      float scale = zoom < 1. ? 1. + outNorm * atan(outSpeed * (zoom - 1.)) :
                    1. + 2. / PI * (maxScale - 1.) * atan(inSpeed * (zoom - 1.));
      outputPointSize = pointSize * scale;
    }

    gl_PointSize = max(outputPointSize * scaleFactor, ${MIN_POINT_SIZE.toFixed(1)});
  }`;
}

const FRAGMENT_SHADER_POINT_TEST_CHUNK = `
  bool point_in_unit_circle(vec2 spriteCoord) {
    vec2 centerToP = spriteCoord - vec2(0.5, 0.5);
    return dot(centerToP, centerToP) < (0.5 * 0.5);
  }

  bool point_in_unit_square(vec2 spriteCoord) {
    return true;
  }
`;

function createFragmentShader() {
  return `
  varying vec2 xyIndex;
  varying vec3 vColor;
  uniform bool isImage;

  ${THREE.ShaderChunk['fog_pars_fragment']}
  ${FRAGMENT_SHADER_POINT_TEST_CHUNK}

  void main() {
    if (isImage) {
      gl_FragColor = vec4(vColor, 1.0);
    } else {
      bool inside = point_in_unit_circle(gl_PointCoord);
      if (!inside) {
        discard;
      }
      gl_FragColor = vec4(vColor, 1.0);
    }
    ${THREE.ShaderChunk['fog_fragment']}
  }`;
}

function createPickingVertexShader() {
  return `
  attribute vec3 color;
  attribute float scaleFactor;

  varying vec3 vColor;

  uniform bool sizeAttenuation;
  uniform float pointSize;

  void main() {
    vColor = color;
    vec4 cameraSpacePos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * cameraSpacePos;

    float outputPointSize = pointSize;
    if (sizeAttenuation) {
      outputPointSize = -pointSize / cameraSpacePos.z;
    }

    gl_PointSize = max(outputPointSize * scaleFactor, ${MIN_POINT_SIZE.toFixed(1)});
  }`;
}

function createPickingFragmentShader() {
  return `
  varying vec3 vColor;

  ${FRAGMENT_SHADER_POINT_TEST_CHUNK}

  void main() {
    bool inside = point_in_unit_circle(gl_PointCoord);
    if (!inside) {
      discard;
    }
    gl_FragColor = vec4(vColor, 1.0);
  }`;
}

/**
 * Uses THREE.js's built-in Points to render points with GPU-friendly shaders.
 */
export class ScatterPlotVisualizerSprites implements ScatterPlotVisualizer {
  private scene!: THREE.Scene;
  private fog!: THREE.Fog;
  private points!: THREE.Points;
  private pickingPoints!: THREE.Points;
  private renderMaterial!: THREE.ShaderMaterial;
  private pickingMaterial!: THREE.ShaderMaterial;
  private geometry!: THREE.BufferGeometry;
  private pickingGeometry!: THREE.BufferGeometry;
  private positionAttribute!: THREE.BufferAttribute;
  private renderColors!: THREE.BufferAttribute;
  private pickingColors!: THREE.BufferAttribute;
  private scaleFactors!: THREE.BufferAttribute;
  private pickingScaleFactors!: THREE.BufferAttribute;
  private worldSpacePointPositions: Float32Array = new Float32Array(0);

  private defaultPointColor = new THREE.Color(0.2, 0.2, 0.8);
  private pointSize = 80;

  constructor() {}

  private createGeometry(pointCount: number): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(pointCount * 3), 3)
    );
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(pointCount * 3), 3)
    );
    geometry.setAttribute(
      'scaleFactor',
      new THREE.BufferAttribute(new Float32Array(pointCount), 1)
    );
    geometry.setAttribute(
      'spriteIndex',
      new THREE.BufferAttribute(new Float32Array(pointCount), 1)
    );
    return geometry;
  }

  private createRenderMaterial(sizeAttenuation: boolean): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      vertexShader: createVertexShader(),
      fragmentShader: createFragmentShader(),
      transparent: true,
      depthTest: true,
      depthWrite: true,
      fog: true,
      blending: THREE.NormalBlending,
      uniforms: {
        sizeAttenuation: { value: sizeAttenuation },
        pointSize: { value: this.pointSize },
        isImage: { value: false },
        spritesPerRow: { value: 1 },
        spritesPerColumn: { value: 1 },
        fogColor: { value: new THREE.Color(1, 1, 1) },
        fogNear: { value: 1 },
        fogFar: { value: 100 },
      },
    });
    return material;
  }

  private createPickingMaterial(sizeAttenuation: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: createPickingVertexShader(),
      fragmentShader: createPickingFragmentShader(),
      transparent: true,
      depthTest: true,
      depthWrite: true,
      fog: false,
      blending: THREE.NormalBlending,
      uniforms: {
        sizeAttenuation: { value: sizeAttenuation },
        pointSize: { value: this.pointSize },
      },
    });
  }

  private createPointSprites(
    scene: THREE.Scene,
    positions: Float32Array
  ) {
    const pointCount = positions.length / 3;
    if (pointCount === 0) return;

    // Create main render geometry and material
    this.geometry = this.createGeometry(pointCount);
    this.positionAttribute = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.renderColors = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    this.scaleFactors = this.geometry.getAttribute('scaleFactor') as THREE.BufferAttribute;

    // Set positions
    for (let i = 0; i < positions.length; i++) {
      this.positionAttribute.array[i] = positions[i];
    }
    this.positionAttribute.needsUpdate = true;

    // Set default colors and scale factors
    for (let i = 0; i < pointCount; i++) {
      this.renderColors.setXYZ(i, this.defaultPointColor.r, this.defaultPointColor.g, this.defaultPointColor.b);
      this.scaleFactors.setX(i, 1.0);
    }
    this.renderColors.needsUpdate = true;
    this.scaleFactors.needsUpdate = true;

    this.renderMaterial = this.createRenderMaterial(true);
    this.points = new THREE.Points(this.geometry, this.renderMaterial);
    scene.add(this.points);

    // Create picking geometry and material
    this.pickingGeometry = this.createGeometry(pointCount);
    const pickingPositions = this.pickingGeometry.getAttribute('position') as THREE.BufferAttribute;
    this.pickingColors = this.pickingGeometry.getAttribute('color') as THREE.BufferAttribute;
    this.pickingScaleFactors = this.pickingGeometry.getAttribute('scaleFactor') as THREE.BufferAttribute;

    for (let i = 0; i < positions.length; i++) {
      pickingPositions.array[i] = positions[i];
    }
    pickingPositions.needsUpdate = true;

    // Set picking colors (encode point index in RGB)
    for (let i = 0; i < pointCount; i++) {
      const r = (i & 0xff) / 255;
      const g = ((i >> 8) & 0xff) / 255;
      const b = ((i >> 16) & 0xff) / 255;
      this.pickingColors.setXYZ(i, r, g, b);
      this.pickingScaleFactors.setX(i, 1.0);
    }
    this.pickingColors.needsUpdate = true;
    this.pickingScaleFactors.needsUpdate = true;

    this.pickingMaterial = this.createPickingMaterial(true);
    this.pickingPoints = new THREE.Points(this.pickingGeometry, this.pickingMaterial);
    this.pickingPoints.visible = false;
    scene.add(this.pickingPoints);
  }

  setScene(scene: THREE.Scene) {
    this.scene = scene;
  }

  onPointPositionsChanged(newPositions: Float32Array) {
    this.worldSpacePointPositions = newPositions;
    this.dispose();
    if (newPositions.length > 0 && this.scene) {
      this.createPointSprites(this.scene, newPositions);
    }
  }

  onResize(newWidth: number, newHeight: number) {
    // No-op for sprites
  }

  onPickingRender(rc: RenderContext) {
    if (!this.pickingPoints || !this.points) return;

    // Swap visibility for picking render
    this.pickingPoints.visible = true;
    this.points.visible = false;

    // Update picking material uniforms
    if (this.pickingMaterial) {
      this.pickingMaterial.uniforms.sizeAttenuation.value =
        rc.cameraType === CameraType.Perspective;
    }
  }

  onRender(rc: RenderContext) {
    if (!this.points || !this.pickingPoints) return;

    // Swap visibility for color render
    this.points.visible = true;
    this.pickingPoints.visible = false;

    // Update render material uniforms
    if (this.renderMaterial) {
      this.renderMaterial.uniforms.sizeAttenuation.value =
        rc.cameraType === CameraType.Perspective;
      // Sync fog color with background for dark mode support
      this.renderMaterial.uniforms.fogColor.value = new THREE.Color(rc.backgroundColor);
    }

    // Update colors if provided
    if (rc.pointColors && rc.pointColors.length > 0 && this.renderColors) {
      const numPoints = rc.pointColors.length / 3;
      for (let i = 0; i < numPoints; i++) {
        this.renderColors.setXYZ(
          i,
          rc.pointColors[i * 3],
          rc.pointColors[i * 3 + 1],
          rc.pointColors[i * 3 + 2]
        );
      }
      this.renderColors.needsUpdate = true;
    }

    // Update scale factors if provided
    if (rc.pointScaleFactors && rc.pointScaleFactors.length > 0 && this.scaleFactors) {
      for (let i = 0; i < rc.pointScaleFactors.length; i++) {
        this.scaleFactors.setX(i, rc.pointScaleFactors[i]);
        if (this.pickingScaleFactors) {
          this.pickingScaleFactors.setX(i, rc.pointScaleFactors[i]);
        }
      }
      this.scaleFactors.needsUpdate = true;
      if (this.pickingScaleFactors) {
        this.pickingScaleFactors.needsUpdate = true;
      }
    }
  }

  onBackgroundColorChanged(color: number) {
    if (this.renderMaterial) {
      const c = new THREE.Color(color);
      this.renderMaterial.uniforms.fogColor.value = c;
    }
  }

  dispose() {
    if (this.points) {
      this.scene?.remove(this.points);
      this.geometry?.dispose();
      this.renderMaterial?.dispose();
    }
    if (this.pickingPoints) {
      this.scene?.remove(this.pickingPoints);
      this.pickingGeometry?.dispose();
      this.pickingMaterial?.dispose();
    }
  }
}
