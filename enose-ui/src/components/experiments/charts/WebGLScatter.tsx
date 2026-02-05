"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface ScatterPoint {
  id: string;
  coords: number[];
  cluster: number;
  label?: string;
}

interface WebGLScatterProps {
  points: ScatterPoint[];
  centers?: ScatterPoint[];
  colorScheme?: string[];
  onPointClick?: (point: ScatterPoint) => void;
  onPointHover?: (point: ScatterPoint | null) => void;
  is3D?: boolean;
}

const DEFAULT_COLORS = [
  "#4e79a7", "#f28e2c", "#e15759", "#76b7b2", "#59a14f",
  "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab",
];

export function WebGLScatter({
  points,
  centers = [],
  colorScheme = DEFAULT_COLORS,
  onPointClick,
  onPointHover,
  is3D = false,
}: WebGLScatterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const animationRef = useRef<number>(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // 初始化场景
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // 场景
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xfafafa);
    sceneRef.current = scene;

    // 相机
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = is3D ? 5 : 3;
    cameraRef.current = camera;

    // 渲染器
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 控制器
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    if (!is3D) {
      controls.enableRotate = false;
    }
    controlsRef.current = controls;

    // 网格辅助线
    const gridHelper = new THREE.GridHelper(10, 20, 0xcccccc, 0xeeeeee);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);

    // 动画循环
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // 清理
    return () => {
      cancelAnimationFrame(animationRef.current);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [is3D]);

  // 更新点
  useEffect(() => {
    if (!sceneRef.current || points.length === 0) return;

    const scene = sceneRef.current;

    // 移除旧的点
    if (pointsRef.current) {
      scene.remove(pointsRef.current);
      pointsRef.current.geometry.dispose();
      (pointsRef.current.material as THREE.Material).dispose();
    }

    // 计算数据范围用于归一化
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    points.forEach((p) => {
      minX = Math.min(minX, p.coords[0]);
      maxX = Math.max(maxX, p.coords[0]);
      minY = Math.min(minY, p.coords[1]);
      maxY = Math.max(maxY, p.coords[1]);
      if (is3D && p.coords[2] !== undefined) {
        minZ = Math.min(minZ, p.coords[2]);
        maxZ = Math.max(maxZ, p.coords[2]);
      }
    });

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const rangeZ = is3D ? (maxZ - minZ || 1) : 1;
    const scale = 4 / Math.max(rangeX, rangeY, rangeZ);

    // 创建几何体
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];

    points.forEach((p, idx) => {
      const x = (p.coords[0] - (minX + maxX) / 2) * scale;
      const y = (p.coords[1] - (minY + maxY) / 2) * scale;
      const z = is3D && p.coords[2] !== undefined 
        ? (p.coords[2] - (minZ + maxZ) / 2) * scale 
        : 0;

      positions.push(x, y, z);

      const color = new THREE.Color(colorScheme[p.cluster % colorScheme.length]);
      colors.push(color.r, color.g, color.b);

      sizes.push(hoveredIdx === idx ? 12 : 6);
    });

    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));

    // 着色器材质
    const material = new THREE.ShaderMaterial({
      uniforms: {
        pointTexture: { value: createCircleTexture() },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D pointTexture;
        varying vec3 vColor;
        void main() {
          gl_FragColor = vec4(vColor, 1.0) * texture2D(pointTexture, gl_PointCoord);
          if (gl_FragColor.a < 0.5) discard;
        }
      `,
      transparent: true,
    });

    const pointCloud = new THREE.Points(geometry, material);
    scene.add(pointCloud);
    pointsRef.current = pointCloud;

    // 添加聚类中心
    if (centers.length > 0) {
      const centerGeometry = new THREE.BufferGeometry();
      const centerPositions: number[] = [];

      centers.forEach((c) => {
        const x = (c.coords[0] - (minX + maxX) / 2) * scale;
        const y = (c.coords[1] - (minY + maxY) / 2) * scale;
        const z = is3D && c.coords[2] !== undefined 
          ? (c.coords[2] - (minZ + maxZ) / 2) * scale 
          : 0;
        centerPositions.push(x, y, z);
      });

      centerGeometry.setAttribute("position", new THREE.Float32BufferAttribute(centerPositions, 3));

      const centerMaterial = new THREE.PointsMaterial({
        color: 0x000000,
        size: 0.15,
        sizeAttenuation: true,
      });

      const centerPoints = new THREE.Points(centerGeometry, centerMaterial);
      scene.add(centerPoints);
    }
  }, [points, centers, colorScheme, is3D, hoveredIdx]);

  // 窗口大小调整
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };

    window.addEventListener("resize", handleResize);
    
    // 初始调整
    const timer = setTimeout(handleResize, 100);
    
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timer);
    };
  }, []);

  // 鼠标事件
  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!containerRef.current || !cameraRef.current || !pointsRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    raycasterRef.current.params.Points = { threshold: 0.1 };

    const intersects = raycasterRef.current.intersectObject(pointsRef.current);

    if (intersects.length > 0) {
      const idx = intersects[0].index;
      if (idx !== undefined && idx !== hoveredIdx) {
        setHoveredIdx(idx);
        onPointHover?.(points[idx]);
      }
    } else if (hoveredIdx !== null) {
      setHoveredIdx(null);
      onPointHover?.(null);
    }
  }, [points, hoveredIdx, onPointHover]);

  const handleClick = useCallback(() => {
    if (hoveredIdx !== null && onPointClick) {
      onPointClick(points[hoveredIdx]);
    }
  }, [hoveredIdx, points, onPointClick]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full cursor-crosshair"
      onMouseMove={handleMouseMove}
      onClick={handleClick}
    />
  );
}

// 创建圆形纹理
function createCircleTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d")!;
  const center = size / 2;
  const radius = size / 2 - 2;

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = "white";
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export default WebGLScatter;
