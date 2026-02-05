"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface TimeSeriesData {
  sampleId: string;
  sensorIdx: number;
  points: { time: number; value: number }[];
  color?: string;
}

interface WebGLTimeSeriesProps {
  series: TimeSeriesData[];
  xLabel?: string;
  yLabel?: string;
  onPointHover?: (info: { sampleId: string; sensorIdx: number; time: number; value: number } | null) => void;
}

const DEFAULT_COLORS = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
  "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
];

export function WebGLTimeSeries({
  series,
  xLabel = "Time",
  yLabel = "Value",
  onPointHover,
}: WebGLTimeSeriesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const linesRef = useRef<THREE.Line[]>([]);
  const animationRef = useRef<number>(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  // 初始化场景
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // 场景
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    sceneRef.current = scene;

    // 正交相机（2D视图）
    const aspect = width / height;
    const frustumSize = 10;
    const camera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      1000
    );
    camera.position.z = 10;
    cameraRef.current = camera;

    // 渲染器
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 控制器（只允许平移和缩放）
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    // 添加坐标轴
    addAxes(scene);

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
  }, []);

  // 添加坐标轴
  function addAxes(scene: THREE.Scene) {
    const axesMaterial = new THREE.LineBasicMaterial({ color: 0x333333 });
    
    // X轴
    const xAxisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-5, -4, 0),
      new THREE.Vector3(5, -4, 0),
    ]);
    const xAxis = new THREE.Line(xAxisGeometry, axesMaterial);
    scene.add(xAxis);

    // Y轴
    const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-5, -4, 0),
      new THREE.Vector3(-5, 4, 0),
    ]);
    const yAxis = new THREE.Line(yAxisGeometry, axesMaterial);
    scene.add(yAxis);

    // 网格线
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0xeeeeee });
    for (let i = -4; i <= 4; i++) {
      if (i === -4) continue;
      // 水平线
      const hGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-5, i, 0),
        new THREE.Vector3(5, i, 0),
      ]);
      scene.add(new THREE.Line(hGeometry, gridMaterial));
    }
    for (let i = -5; i <= 5; i += 2) {
      if (i === -5) continue;
      // 垂直线
      const vGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(i, -4, 0),
        new THREE.Vector3(i, 4, 0),
      ]);
      scene.add(new THREE.Line(vGeometry, gridMaterial));
    }
  }

  // 更新数据
  useEffect(() => {
    if (!sceneRef.current || series.length === 0) return;

    const scene = sceneRef.current;

    // 移除旧的线条
    linesRef.current.forEach((line) => {
      scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    linesRef.current = [];

    // 计算数据范围
    let minTime = Infinity, maxTime = -Infinity;
    let minValue = Infinity, maxValue = -Infinity;

    series.forEach((s) => {
      s.points.forEach((p) => {
        minTime = Math.min(minTime, p.time);
        maxTime = Math.max(maxTime, p.time);
        minValue = Math.min(minValue, p.value);
        maxValue = Math.max(maxValue, p.value);
      });
    });

    const timeRange = maxTime - minTime || 1;
    const valueRange = maxValue - minValue || 1;

    // 映射函数
    const mapX = (time: number) => ((time - minTime) / timeRange) * 10 - 5;
    const mapY = (value: number) => ((value - minValue) / valueRange) * 8 - 4;

    // 为每个系列创建线条
    series.forEach((s, idx) => {
      if (s.points.length < 2) return;

      const color = s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
      const points = s.points.map((p) => new THREE.Vector3(mapX(p.time), mapY(p.value), 0));

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ 
        color: new THREE.Color(color),
        linewidth: 1,
      });
      const line = new THREE.Line(geometry, material);
      
      // 存储元数据
      (line as unknown as { userData: { sampleId: string; sensorIdx: number } }).userData = {
        sampleId: s.sampleId,
        sensorIdx: s.sensorIdx,
      };

      scene.add(line);
      linesRef.current.push(line);
    });
  }, [series]);

  // 窗口大小调整
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      const aspect = width / height;
      const frustumSize = 10;

      cameraRef.current.left = -frustumSize * aspect / 2;
      cameraRef.current.right = frustumSize * aspect / 2;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };

    window.addEventListener("resize", handleResize);
    const timer = setTimeout(handleResize, 100);

    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timer);
    };
  }, []);

  // 鼠标移动处理
  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // 简单的 tooltip 逻辑 - 可以扩展为精确的线条交叉检测
    if (series.length > 0 && x > 50 && x < rect.width - 20) {
      const progress = (x - 50) / (rect.width - 70);
      const s = series[0];
      if (s.points.length > 0) {
        const idx = Math.floor(progress * (s.points.length - 1));
        const point = s.points[Math.min(idx, s.points.length - 1)];
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          text: `Time: ${point.time.toFixed(0)}, Value: ${point.value.toFixed(2)}`,
        });
        onPointHover?.({
          sampleId: s.sampleId,
          sensorIdx: s.sensorIdx,
          time: point.time,
          value: point.value,
        });
      }
    } else {
      setTooltip(null);
      onPointHover?.(null);
    }
  }, [series, onPointHover]);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    onPointHover?.(null);
  }, [onPointHover]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="w-full h-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {/* 轴标签 */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-muted-foreground">
        {xLabel}
      </div>
      <div className="absolute left-2 top-1/2 -translate-y-1/2 -rotate-90 text-xs text-muted-foreground">
        {yLabel}
      </div>
      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute bg-background border rounded px-2 py-1 text-xs shadow-lg pointer-events-none z-10"
          style={{ left: tooltip.x + 10, top: tooltip.y - 30 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

export default WebGLTimeSeries;
