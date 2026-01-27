'use client';

import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  useOnSelectionChange,
  Node,
  Edge,
  SelectionMode,
  PanOnScrollMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './editor-styles.css';

import { useEditorStore } from './store';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { NodePalette } from './panels/NodePalette';
import { PropertyPanel } from './panels/PropertyPanel';
import { SelectionToolbar } from './panels/SelectionToolbar';
import { CompilerPanel } from './panels/CompilerPanel';
import { StatusBar } from './panels/StatusBar';
import { NodeType, NODE_CATEGORIES, validateDAG } from './types';
import { graphToYaml, yamlToGraph } from './yaml-converter';
import { templates } from './templates';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Save, FileDown, Trash2, Play, Upload, CheckCircle, LayoutTemplate, Undo2, Redo2, FolderOpen, HardDrive, ChevronDown, FilePlus, ZoomIn, ZoomOut, Maximize2, Focus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ConfirmDialog, UnsavedChangesDialog } from './ConfirmDialog';
import { EditorContextMenu } from './panels/ContextMenu';

function getCategoryColor(nodeType: string): string {
  for (const [, category] of Object.entries(NODE_CATEGORIES)) {
    if (category.nodes.includes(nodeType as NodeType)) {
      return category.color;
    }
  }
  return '#6b7280';
}

function EditorCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, setNodes, getNodes, setEdges, getEdges, fitView } = useReactFlow();
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);
  const [clipboard, setClipboard] = useState<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });
  
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    setSelectedNodeId,
    saveToHistory,
    undo,
    redo,
  } = useEditorStore();

  // 监听选择变化
  useOnSelectionChange({
    onChange: ({ nodes: selected }) => {
      setSelectedNodes(selected);
      // 如果只选中一个节点，更新属性面板
      if (selected.length === 1) {
        setSelectedNodeId(selected[0].id);
      } else if (selected.length === 0) {
        setSelectedNodeId(null);
      }
    },
  });

  // 快捷键支持
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框中，不处理快捷键
      if ((e.target as HTMLElement).tagName === 'INPUT' || 
          (e.target as HTMLElement).tagName === 'TEXTAREA') {
        return;
      }
      
      const isCtrl = e.ctrlKey || e.metaKey;
      
      // Ctrl+A: 全选
      if (isCtrl && e.key === 'a') {
        e.preventDefault();
        setNodes(nodes => nodes.map(n => ({ ...n, selected: true })));
      }
      
      // Ctrl+Z: 撤销
      if (isCtrl && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      
      // Ctrl+Shift+Z 或 Ctrl+Y: 重做
      if ((isCtrl && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
          (isCtrl && (e.key === 'y' || e.key === 'Y'))) {
        e.preventDefault();
        redo();
      }
      
      // Ctrl+C: 复制
      if (isCtrl && e.key === 'c') {
        e.preventDefault();
        const selectedNodesList = getNodes().filter(n => n.selected);
        if (selectedNodesList.length > 0) {
          const selectedIds = new Set(selectedNodesList.map(n => n.id));
          const selectedEdgesList = getEdges().filter(
            edge => selectedIds.has(edge.source) && selectedIds.has(edge.target)
          );
          setClipboard({ nodes: selectedNodesList, edges: selectedEdgesList });
        }
      }
      
      // Ctrl+V: 粘贴
      if (isCtrl && e.key === 'v') {
        e.preventDefault();
        if (clipboard.nodes.length > 0) {
          saveToHistory();
          const allNodes = getNodes();
          let maxId = 0;
          for (const node of allNodes) {
            const match = node.id.match(/node_(\d+)/);
            if (match) maxId = Math.max(maxId, parseInt(match[1]));
          }
          
          const idMap = new Map<string, string>();
          const newNodes: Node[] = [];
          
          for (const node of clipboard.nodes) {
            const newId = `node_${++maxId}`;
            idMap.set(node.id, newId);
            newNodes.push({
              ...node,
              id: newId,
              position: { x: node.position.x + 50, y: node.position.y + 50 },
              selected: true,
            });
          }
          
          const newEdges = clipboard.edges.map(edge => ({
            ...edge,
            id: `edge_${edge.source}_${edge.target}_${Date.now()}`,
            source: idMap.get(edge.source) || edge.source,
            target: idMap.get(edge.target) || edge.target,
          }));
          
          setNodes(nodes => [...nodes.map(n => ({ ...n, selected: false })), ...newNodes]);
          setEdges(edges => [...edges, ...newEdges]);
        }
      }
      
      // Ctrl+X: 剪切
      if (isCtrl && e.key === 'x') {
        e.preventDefault();
        const selectedNodesList = getNodes().filter(n => n.selected);
        if (selectedNodesList.length > 0) {
          saveToHistory();
          const selectedIds = new Set(selectedNodesList.map(n => n.id));
          const selectedEdgesList = getEdges().filter(
            edge => selectedIds.has(edge.source) && selectedIds.has(edge.target)
          );
          setClipboard({ nodes: selectedNodesList, edges: selectedEdgesList });
          
          // 删除选中的节点和相关边
          setNodes(nodes => nodes.filter(n => !selectedIds.has(n.id)));
          setEdges(edges => edges.filter(e => !selectedIds.has(e.source) && !selectedIds.has(e.target)));
        }
      }
      
      // Delete/Backspace: 删除选中节点
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const selectedNodesList = getNodes().filter(n => n.selected);
        if (selectedNodesList.length > 0) {
          saveToHistory();
          const selectedIds = new Set(selectedNodesList.map(n => n.id));
          setNodes(nodes => nodes.filter(n => !selectedIds.has(n.id)));
          setEdges(edges => edges.filter(e => !selectedIds.has(e.source) && !selectedIds.has(e.target)));
        }
      }
      
      // Ctrl+0: 适应画布
      if (isCtrl && e.key === '0') {
        e.preventDefault();
        fitView({ padding: 0.2, duration: 300 });
      }
      
      // Ctrl++: 放大
      if (isCtrl && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('editor:zoomIn'));
      }
      
      // Ctrl+-: 缩小
      if (isCtrl && e.key === '-') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('editor:zoomOut'));
      }
      
      // F: 居中选中节点
      if (e.key === 'f' || e.key === 'F') {
        if (!isCtrl) {
          e.preventDefault();
          const selectedNodesList = getNodes().filter(n => n.selected);
          if (selectedNodesList.length > 0) {
            fitView({ 
              nodes: selectedNodesList, 
              padding: 0.5, 
              duration: 300,
              maxZoom: 1.5,
            });
          }
        }
      }
      
    };
    
    // 监听来自工具栏的视图操作事件
    const handleFitView = () => {
      fitView({ padding: 0.2, duration: 300 });
    };
    
    const handleFocusSelected = () => {
      const selectedNodesList = getNodes().filter(n => n.selected);
      if (selectedNodesList.length > 0) {
        fitView({ 
          nodes: selectedNodesList, 
          padding: 0.5, 
          duration: 300,
          maxZoom: 1.5,
        });
      }
    };
    
    const handleZoomIn = () => {
      // 使用 zoomIn 事件触发
      const event = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true });
      document.querySelector('.react-flow')?.dispatchEvent(event);
    };
    
    const handleZoomOut = () => {
      // 使用 zoomOut 事件触发
      const event = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true });
      document.querySelector('.react-flow')?.dispatchEvent(event);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('editor:fitView', handleFitView);
    window.addEventListener('editor:focusSelected', handleFocusSelected);
    window.addEventListener('editor:zoomIn', handleZoomIn);
    window.addEventListener('editor:zoomOut', handleZoomOut);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('editor:fitView', handleFitView);
      window.removeEventListener('editor:focusSelected', handleFocusSelected);
      window.removeEventListener('editor:zoomIn', handleZoomIn);
      window.removeEventListener('editor:zoomOut', handleZoomOut);
    };
  }, [nodes, edges, clipboard, setNodes, setEdges, getNodes, getEdges, saveToHistory, undo, redo, fitView, setSelectedNodeId]);

  // Tab 键导航逻辑
  useEffect(() => {
    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if ((e.target as HTMLElement).tagName === 'INPUT' || 
          (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      
      e.preventDefault();
      const currentNodes = getNodes();
      const currentEdges = getEdges();
      const selectedNode = currentNodes.find(n => n.selected);
      
      if (selectedNode) {
        // 找到下一个连接的节点（优先 flow 边）
        const direction = e.shiftKey ? 'prev' : 'next';
        let nextNodeId: string | null = null;
        
        if (direction === 'next') {
          const outEdge = currentEdges.find(edge => 
            edge.source === selectedNode.id && 
            (!edge.sourceHandle || edge.sourceHandle === 'flow')
          );
          nextNodeId = outEdge?.target || null;
        } else {
          const inEdge = currentEdges.find(edge => 
            edge.target === selectedNode.id && 
            (!edge.targetHandle || edge.targetHandle === 'flow')
          );
          nextNodeId = inEdge?.source || null;
        }
        
        if (nextNodeId) {
          setNodes(nodes => nodes.map(n => ({
            ...n,
            selected: n.id === nextNodeId,
          })));
          setSelectedNodeId(nextNodeId);
        }
      } else {
        // 没有选中节点，选中第一个节点
        const startNode = currentNodes.find(n => n.type === 'start');
        if (startNode) {
          setNodes(nodes => nodes.map(n => ({
            ...n,
            selected: n.id === startNode.id,
          })));
          setSelectedNodeId(startNode.id);
        }
      }
    };
    
    window.addEventListener('keydown', handleTabKey);
    return () => window.removeEventListener('keydown', handleTabKey);
  }, [getNodes, getEdges, setNodes, setSelectedNodeId]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow') as NodeType;
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(type, position);
    },
    [screenToFlowPosition, addNode]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      setSelectedNodeId(node.id);
    },
    [setSelectedNodeId]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  // 右键菜单操作
  const handleContextCopy = useCallback(() => {
    const selectedNodesList = getNodes().filter(n => n.selected);
    if (selectedNodesList.length > 0) {
      const selectedIds = new Set(selectedNodesList.map(n => n.id));
      const selectedEdgesList = getEdges().filter(
        edge => selectedIds.has(edge.source) && selectedIds.has(edge.target)
      );
      setClipboard({ nodes: selectedNodesList, edges: selectedEdgesList });
    }
  }, [getNodes, getEdges]);

  const handleContextCut = useCallback(() => {
    const selectedNodesList = getNodes().filter(n => n.selected);
    if (selectedNodesList.length > 0) {
      saveToHistory();
      const selectedIds = new Set(selectedNodesList.map(n => n.id));
      const selectedEdgesList = getEdges().filter(
        edge => selectedIds.has(edge.source) && selectedIds.has(edge.target)
      );
      setClipboard({ nodes: selectedNodesList, edges: selectedEdgesList });
      setNodes(nodes => nodes.filter(n => !selectedIds.has(n.id)));
      setEdges(edges => edges.filter(e => !selectedIds.has(e.source) && !selectedIds.has(e.target)));
    }
  }, [getNodes, getEdges, saveToHistory, setNodes, setEdges]);

  const handleContextPaste = useCallback(() => {
    if (clipboard.nodes.length > 0) {
      saveToHistory();
      const allNodes = getNodes();
      let maxId = 0;
      for (const node of allNodes) {
        const match = node.id.match(/node_(\d+)/);
        if (match) maxId = Math.max(maxId, parseInt(match[1]));
      }
      
      const idMap = new Map<string, string>();
      const newNodes: Node[] = [];
      
      for (const node of clipboard.nodes) {
        const newId = `node_${++maxId}`;
        idMap.set(node.id, newId);
        newNodes.push({
          ...node,
          id: newId,
          position: { x: node.position.x + 50, y: node.position.y + 50 },
          selected: true,
        });
      }
      
      const newEdges = clipboard.edges.map(edge => ({
        ...edge,
        id: `edge_${edge.source}_${edge.target}_${Date.now()}`,
        source: idMap.get(edge.source) || edge.source,
        target: idMap.get(edge.target) || edge.target,
      }));
      
      setNodes(nodes => [...nodes.map(n => ({ ...n, selected: false })), ...newNodes]);
      setEdges(edges => [...edges, ...newEdges]);
    }
  }, [clipboard, getNodes, saveToHistory, setNodes, setEdges]);

  const handleContextDelete = useCallback(() => {
    const selectedNodesList = getNodes().filter(n => n.selected);
    if (selectedNodesList.length > 0) {
      saveToHistory();
      const selectedIds = new Set(selectedNodesList.map(n => n.id));
      setNodes(nodes => nodes.filter(n => !selectedIds.has(n.id)));
      setEdges(edges => edges.filter(e => !selectedIds.has(e.source) && !selectedIds.has(e.target)));
    }
  }, [getNodes, saveToHistory, setNodes, setEdges]);

  const handleContextSelectAll = useCallback(() => {
    setNodes(nodes => nodes.map(n => ({ ...n, selected: true })));
  }, [setNodes]);

  const handleContextFitView = useCallback(() => {
    fitView({ padding: 0.2, duration: 300 });
  }, [fitView]);

  const hasSelection = selectedNodes.length > 0;
  const hasClipboard = clipboard.nodes.length > 0;

  return (
    <EditorContextMenu
      onCopy={handleContextCopy}
      onCut={handleContextCut}
      onPaste={handleContextPaste}
      onDelete={handleContextDelete}
      onSelectAll={handleContextSelectAll}
      onFitView={handleContextFitView}
      hasSelection={hasSelection}
      hasClipboard={hasClipboard}
    >
      <div ref={reactFlowWrapper} className="flex-1 h-full relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          snapToGrid
          snapGrid={[15, 15]}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={[1, 2]}
          zoomOnScroll
          zoomOnPinch
          deleteKeyCode="Delete"
          defaultEdgeOptions={{
            type: 'smart',
            style: { strokeWidth: 2 },
            deletable: true,
            selectable: true,
            focusable: true,
          }}
          edgesFocusable
        >
          <Background gap={15} size={1} />
          <Controls />
          <MiniMap
            nodeColor={(node) => getCategoryColor(node.type || '')}
            maskColor="rgba(0, 0, 0, 0.1)"
          />
          <SelectionToolbar selectedNodes={selectedNodes} />
        </ReactFlow>
      </div>
    </EditorContextMenu>
  );
}

function EditorToolbar() {
  const {
    nodes,
    edges,
    clearGraph,
    loadGraph,
    programId,
    programName,
    programDescription,
    programVersion,
    bottleCapacityMl,
    maxFillMl,
    setProgramMeta,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useEditorStore();
  
  // 面板可见性状态（监听变化以触发重渲染）
  const [panelState, setPanelState] = useState({ ...panelVisibility });
  
  useEffect(() => {
    const handlePanelChange = () => {
      // 延迟读取以确保全局状态已更新
      setTimeout(() => setPanelState({ ...panelVisibility }), 0);
    };
    window.addEventListener('editor:togglePanel', handlePanelChange);
    return () => window.removeEventListener('editor:togglePanel', handlePanelChange);
  }, []);
  
  
  // 快捷键支持 - 在组件外定义 ref 来保存回调
  const handleSaveRef = useRef<() => void>(() => {});
  const handleNewRef = useRef<() => void>(() => {});
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Z 或 Ctrl+Shift+Z（Windows下Shift会使key变成大写Z）
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) {
          e.preventDefault();
          redo();
        } else {
          e.preventDefault();
          undo();
        }
      }
      // Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
      }
      // Ctrl+S 保存
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSaveRef.current();
      }
      // Ctrl+N 新建
      if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        handleNewRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);
  
  const { isDirty, setDirty } = useEditorStore();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [yamlPreview, setYamlPreview] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [saveFilename, setSaveFilename] = useState('');
  const [currentFilename, setCurrentFilename] = useState<string | null>(null); // 当前打开的文件名
  const [isSaveAs, setIsSaveAs] = useState(false); // 是否是另存为
  const [savedPrograms, setSavedPrograms] = useState<Array<{
    id: string;
    name: string;
    description: string;
    version: string;
    filename: string;
    updatedAt: string;
  }>>([]);
  
  // 确认对话框状态
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [pendingSaveFilename, setPendingSaveFilename] = useState<string | null>(null);
  
  // 加载到实验对话框状态
  const [showLoadResultDialog, setShowLoadResultDialog] = useState(false);
  const [loadResultDialogType, setLoadResultDialogType] = useState<'needSave' | 'confirmSave' | 'success' | 'error'>('needSave');
  const [loadResultMessage, setLoadResultMessage] = useState('');
  const [pendingLoadAfterSave, setPendingLoadAfterSave] = useState(false);
  
  // 最近文件列表
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  
  // 加载最近文件列表
  useEffect(() => {
    const stored = localStorage.getItem('experiment-editor-recent-files');
    if (stored) {
      try {
        setRecentFiles(JSON.parse(stored));
      } catch {
        setRecentFiles([]);
      }
    }
  }, []);
  
  // 添加文件到最近列表
  const addToRecentFiles = (filename: string) => {
    setRecentFiles(prev => {
      const filtered = prev.filter(f => f !== filename);
      const updated = [filename, ...filtered].slice(0, 5); // 保留最近5个
      localStorage.setItem('experiment-editor-recent-files', JSON.stringify(updated));
      return updated;
    });
  };
  
  // 监听从 URL 参数加载文件事件
  useEffect(() => {
    const handleLoadFile = async (e: Event) => {
      const { filename } = (e as CustomEvent).detail;
      if (filename) {
        try {
          const res = await fetch(`/api/experiment/programs?filename=${encodeURIComponent(filename)}`);
          const data = await res.json();
          if (data.content) {
            const { nodes: newNodes, edges: newEdges, programMeta } = yamlToGraph(data.content);
            loadGraph(newNodes, newEdges);
            setProgramMeta(programMeta);
            setCurrentFilename(filename);
            setDirty(false);
            addToRecentFiles(filename);
          }
        } catch (error) {
          console.error('加载文件失败:', error);
        }
      }
    };
    window.addEventListener('editor:loadFile', handleLoadFile);
    return () => window.removeEventListener('editor:loadFile', handleLoadFile);
  }, [loadGraph, setProgramMeta]);
  
  // 自动保存草稿到 localStorage
  useEffect(() => {
    if (!isDirty) return;
    
    const autoSaveInterval = setInterval(() => {
      try {
        const draft = {
          nodes,
          edges,
          programMeta: { programId, programName, programDescription, programVersion, bottleCapacityMl, maxFillMl },
          savedAt: Date.now(),
        };
        localStorage.setItem('experiment-editor-draft', JSON.stringify(draft));
      } catch (e) {
        console.warn('自动保存草稿失败:', e);
      }
    }, 30000); // 每30秒保存一次
    
    return () => clearInterval(autoSaveInterval);
  }, [isDirty, nodes, edges, programId, programName, programDescription, programVersion, bottleCapacityMl, maxFillMl]);
  
  // 启动时检查是否有草稿
  useEffect(() => {
    const stored = localStorage.getItem('experiment-editor-draft');
    if (stored && nodes.length <= 2) { // 只在初始状态时恢复
      try {
        const draft = JSON.parse(stored);
        const savedTime = new Date(draft.savedAt).toLocaleString();
        // 只有草稿比较新（1小时内）才提示恢复
        if (Date.now() - draft.savedAt < 3600000) {
          // 延迟显示提示，避免与初始渲染冲突
          setTimeout(() => {
            if (window.confirm(`发现自动保存的草稿（${savedTime}），是否恢复？`)) {
              loadGraph(draft.nodes, draft.edges);
              setProgramMeta(draft.programMeta);
              setDirty(true);
            }
            localStorage.removeItem('experiment-editor-draft');
          }, 500);
        }
      } catch {
        localStorage.removeItem('experiment-editor-draft');
      }
    }
  }, []); // 只在组件挂载时运行一次

  const handleExportYaml = () => {
    try {
      const yaml = graphToYaml(nodes, edges, {
        programId,
        programName,
        programDescription,
        programVersion,
        bottleCapacityMl,
        maxFillMl,
      });
      
      // 下载 YAML 文件
      const blob = new Blob([yaml], { type: 'text/yaml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${programId || 'experiment'}.yaml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('导出失败:', error);
      alert(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleImportYaml = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const { nodes: newNodes, edges: newEdges, programMeta } = yamlToGraph(content);
        loadGraph(newNodes, newEdges);
        setProgramMeta(programMeta);
      } catch (error) {
        console.error('导入失败:', error);
        alert(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    };
    reader.readAsText(file);
    
    // 重置 input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 加载保存的程序列表
  const loadSavedPrograms = async () => {
    try {
      const res = await fetch('/api/experiment/programs');
      const data = await res.json();
      setSavedPrograms(data.programs || []);
    } catch (error) {
      console.error('加载程序列表失败:', error);
    }
  };

  // 直接保存（如果有当前文件名）
  const handleSave = async () => {
    if (currentFilename) {
      // 直接保存到当前文件
      await doSave(currentFilename.replace(/\.yaml$/, ''));
    } else {
      // 没有当前文件，显示另存为对话框
      setIsSaveAs(false);
      setSaveFilename(programId || '');
      setShowSaveDialog(true);
    }
  };

  // 另存为
  const handleSaveAs = () => {
    setIsSaveAs(true);
    setSaveFilename(currentFilename?.replace(/\.yaml$/, '') || programId || '');
    setShowSaveDialog(true);
  };

  // 新建文档
  const handleNew = () => {
    checkUnsavedChanges(() => {
      clearGraph();
      setProgramMeta({
        programId: 'new_experiment',
        programName: '新实验',
        programDescription: '',
        programVersion: '1.0.0',
      });
      setCurrentFilename(null);
      setDirty(false);
    });
  };
  
  // 更新快捷键回调 ref
  useEffect(() => {
    handleSaveRef.current = handleSave;
    handleNewRef.current = handleNew;
  });

  // 执行保存
  const doSave = async (filename: string) => {
    try {
      const yaml = graphToYaml(nodes, edges, {
        programId,
        programName,
        programDescription,
        programVersion,
        bottleCapacityMl,
        maxFillMl,
      });
      
      const res = await fetch('/api/experiment/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content: yaml }),
      });
      
      const data = await res.json();
      if (data.success) {
        setCurrentFilename(data.filename);
        setShowSaveDialog(false);
        setSaveFilename('');
        setDirty(false); // 保存后清除未保存状态
        // 显示保存成功提示
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-in fade-in slide-in-from-bottom-2';
        toast.textContent = `✅ 已保存到 ${data.filename}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
      } else {
        alert(`保存失败: ${data.error}`);
      }
    } catch (error) {
      alert(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // 检查文件是否存在
  const checkFileExists = async (filename: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/experiment/programs?checkExists=${encodeURIComponent(filename)}`);
      const data = await res.json();
      return data.exists === true;
    } catch {
      return false;
    }
  };

  // 保存对话框确认
  const handleSaveDialogConfirm = async () => {
    const filename = saveFilename || programId || 'experiment';
    
    // 如果是新文件（不是当前打开的文件），检查是否存在
    if (!currentFilename || currentFilename.replace(/\.yaml$/, '') !== filename) {
      const exists = await checkFileExists(filename);
      if (exists) {
        setPendingSaveFilename(filename);
        setShowOverwriteConfirm(true);
        return;
      }
    }
    
    await doSave(filename);
  };
  
  // 确认覆盖后保存
  const handleConfirmOverwrite = async () => {
    if (pendingSaveFilename) {
      await doSave(pendingSaveFilename);
      setPendingSaveFilename(null);
    }
    setShowOverwriteConfirm(false);
  };

  // 检查未保存更改，如果有则显示对话框
  const checkUnsavedChanges = (action: () => void) => {
    if (isDirty) {
      setPendingAction(() => action);
      setShowUnsavedDialog(true);
    } else {
      action();
    }
  };

  // 从系统加载
  const handleLoadFromSystem = async (filename: string) => {
    try {
      const res = await fetch(`/api/experiment/programs?filename=${encodeURIComponent(filename)}`);
      const data = await res.json();
      
      if (data.content) {
        const { nodes: newNodes, edges: newEdges, programMeta } = yamlToGraph(data.content);
        loadGraph(newNodes, newEdges);
        setProgramMeta(programMeta);
        setCurrentFilename(filename); // 记录当前文件名
        setDirty(false); // 加载后重置未保存状态
        setShowLoadDialog(false);
        addToRecentFiles(filename); // 添加到最近文件
      } else {
        alert(`加载失败: ${data.error || '未知错误'}`);
      }
    } catch (error) {
      alert(`加载失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // 删除保存的程序
  const handleDeleteProgram = async (filename: string) => {
    if (!confirm(`确定要删除 ${filename} 吗？`)) return;
    
    try {
      const res = await fetch(`/api/experiment/programs?filename=${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      
      const data = await res.json();
      if (data.success) {
        loadSavedPrograms();
      } else {
        alert(`删除失败: ${data.error}`);
      }
    } catch (error) {
      alert(`删除失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handlePreviewYaml = () => {
    try {
      const yaml = graphToYaml(nodes, edges, {
        programId,
        programName,
        programDescription,
        programVersion,
        bottleCapacityMl,
        maxFillMl,
      });
      setYamlPreview(yaml);
    } catch (error) {
      alert(`预览失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleValidate = async () => {
    try {
      // 1. 本地静态检查
      const localValidation = validateDAG(nodes, edges);
      
      let message = '';
      
      if (localValidation.errors.length > 0) {
        message += '❌ 结构错误：\n' + localValidation.errors.map(e => `• ${e}`).join('\n') + '\n\n';
      }
      
      if (localValidation.warnings.length > 0) {
        message += '⚠️ 警告：\n' + localValidation.warnings.map(w => `• ${w}`).join('\n') + '\n\n';
      }
      
      if (!localValidation.valid) {
        alert(message + '请修复上述问题后再验证。');
        return;
      }
      
      // 2. 后端验证
      try {
        const yaml = graphToYaml(nodes, edges, {
          programId,
          programName,
          programDescription,
          programVersion,
          bottleCapacityMl,
          maxFillMl,
        });
        
        const res = await fetch('/api/experiment?action=validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ yamlContent: yaml }),
        });
        
        const data = await res.json();
        if (data.valid) {
          let successMsg = '✅ 验证通过！\n\n';
          successMsg += `预计时长: ${Math.round(data.estimate?.estimatedDurationS || 0)}秒\n`;
          successMsg += `峰值液位: ${data.estimate?.peakLiquidLevelMl?.toFixed(1) || 0}ml`;
          
          if (localValidation.warnings.length > 0) {
            successMsg += '\n\n⚠️ 警告（不影响运行）：\n' + localValidation.warnings.map(w => `• ${w}`).join('\n');
          }
          
          alert(successMsg);
        } else {
          const errors = data.errors?.map((e: { message: string }) => `• ${e.message}`).join('\n') || '未知错误';
          alert('❌ 后端验证失败：\n\n' + errors);
        }
      } catch {
        // 后端不可用时仍显示本地验证结果
        if (localValidation.warnings.length > 0) {
          alert('✅ 本地验证通过（后端不可用）\n\n⚠️ 警告：\n' + localValidation.warnings.map(w => `• ${w}`).join('\n'));
        } else {
          alert('✅ 本地验证通过（后端不可用，无法获取时长估算）');
        }
      }
    } catch (err) {
      console.error('验证出错:', err);
      alert(`验证出错: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleLoadToExperiment = async () => {
    // 必须先保存才能加载
    if (!currentFilename) {
      setLoadResultDialogType('needSave');
      setLoadResultMessage('请先保存文件后再加载到实验。\n\n点击"文件 → 保存"或使用 Ctrl+S。');
      setShowLoadResultDialog(true);
      return;
    }
    
    // 如果有未保存的更改，提示保存
    if (isDirty) {
      setLoadResultDialogType('confirmSave');
      setLoadResultMessage('有未保存的更改，是否先保存后再跳转到实验管理？');
      setPendingLoadAfterSave(true);
      setShowLoadResultDialog(true);
      return;
    }
    
    // 跳转到实验管理页面，带上文件名参数让用户在那里加载
    doLoadToExperiment();
  };
  
  const doLoadToExperiment = () => {
    if (!currentFilename) return;
    
    // 跳转到实验管理页面，带上文件名参数，由用户在实验管理页面点击加载
    setLoadResultDialogType('success');
    setLoadResultMessage(`文件已保存！\n\n点击确定跳转到实验管理页面，在那里选择 "${currentFilename}" 并点击加载按钮。`);
    setShowLoadResultDialog(true);
  };
  
  
  const handleLoadResultDialogConfirm = async () => {
    if (loadResultDialogType === 'confirmSave') {
      // 用户确认保存，执行保存后加载
      const yaml = graphToYaml(nodes, edges, {
        programId,
        programName,
        programDescription,
        programVersion,
        bottleCapacityMl,
        maxFillMl,
      });
      
      try {
        const saveRes = await fetch('/api/experiment/programs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: currentFilename, content: yaml }),
        });
        
        const saveData = await saveRes.json();
        if (!saveData.success) {
          setLoadResultDialogType('error');
          setLoadResultMessage(`保存失败: ${saveData.error || '未知错误'}`);
          return;
        }
        setDirty(false);
        setShowLoadResultDialog(false);
        // 保存成功后执行加载
        await doLoadToExperiment();
      } catch (error) {
        setLoadResultDialogType('error');
        setLoadResultMessage(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    } else if (loadResultDialogType === 'success') {
      // 加载成功，跳转到实验管理页面
      setShowLoadResultDialog(false);
      window.location.href = '/experiment';
    } else {
      // 其他情况直接关闭
      setShowLoadResultDialog(false);
    }
    setPendingLoadAfterSave(false);
  };

  const handleRun = async () => {
    try {
      const yaml = graphToYaml(nodes, edges, {
        programId,
        programName,
        programDescription,
        programVersion,
        bottleCapacityMl,
        maxFillMl,
      });
      
      // 先加载程序
      const loadRes = await fetch('/api/experiment?action=load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yamlContent: yaml }),
      });
      
      const loadData = await loadRes.json();
      if (!loadData.success) {
        alert(`加载失败: ${loadData.errorMessage || '未知错误'}`);
        return;
      }
      
      // 启动实验
      const startRes = await fetch('/api/experiment?action=start', {
        method: 'POST',
      });
      
      const startData = await startRes.json();
      if (startData.state === 3) { // EXP_RUNNING
        alert('✅ 实验已启动！\n\n请在实验管理页面查看进度。');
        window.open('/experiment', '_blank');
      } else {
        alert(`启动失败: ${startData.message || '未知错误'}`);
      }
    } catch (error) {
      alert(`运行失败: ${error instanceof Error ? error.message : '网络错误'}`);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">
            {programName || '实验编程器'}
            {isDirty && <span className="text-orange-500 ml-1">*</span>}
          </h2>
          {currentFilename && (
            <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
              {currentFilename}
              {isDirty && <span className="text-orange-500 ml-0.5">*</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center border-r pr-2 mr-1">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={undo} 
              disabled={!canUndo()}
              title="撤销 (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={redo} 
              disabled={!canRedo()}
              title="重做 (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-4 h-4" />
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml"
            onChange={handleImportYaml}
            className="hidden"
          />
          
          {/* 新建按钮 */}
          <Button variant="outline" size="sm" onClick={handleNew} title="新建 (Ctrl+N)">
            <FilePlus className="w-4 h-4 mr-1" />
            新建
          </Button>
          
          {/* 打开按钮（含模板和已保存程序） */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <FolderOpen className="w-4 h-4 mr-1" />
                打开
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {recentFiles.length > 0 && (
                <>
                  <DropdownMenuLabel>最近打开</DropdownMenuLabel>
                  {recentFiles.map((filename, index) => (
                    <DropdownMenuItem
                      key={`recent-${filename}-${index}`}
                      onClick={() => {
                        checkUnsavedChanges(() => {
                          handleLoadFromSystem(filename);
                        });
                      }}
                    >
                      <HardDrive className="w-4 h-4 mr-2" />
                      <span className="truncate">{filename}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuLabel>模板</DropdownMenuLabel>
              {templates.map((t, index) => (
                <DropdownMenuItem
                  key={`template-${t.id}-${index}`}
                  onClick={() => {
                    checkUnsavedChanges(() => {
                      loadGraph(t.nodes, t.edges);
                      setProgramMeta(t.programMeta);
                      setCurrentFilename(null);
                      setDirty(false);
                    });
                  }}
                >
                  <LayoutTemplate className="w-4 h-4 mr-2" />
                  {t.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => {
                checkUnsavedChanges(() => {
                  loadSavedPrograms();
                  setShowLoadDialog(true);
                });
              }}>
                <FolderOpen className="w-4 h-4 mr-2" />
                打开已保存...
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                checkUnsavedChanges(() => {
                  fileInputRef.current?.click();
                });
              }}>
                <Upload className="w-4 h-4 mr-2" />
                导入文件...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          {/* 保存按钮（含另存为） */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Save className="w-4 h-4 mr-1" />
                保存
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={handleSave}>
                <HardDrive className="w-4 h-4 mr-2" />
                {currentFilename ? `保存到 ${currentFilename}` : '保存'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSaveAs}>
                <Save className="w-4 h-4 mr-2" />
                另存为...
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handlePreviewYaml}>
                <FileDown className="w-4 h-4 mr-2" />
                预览 YAML
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportYaml}>
                <FileDown className="w-4 h-4 mr-2" />
                导出文件
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <div className="border-l mx-1 h-6" />
          
          {/* 视图操作 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Maximize2 className="w-4 h-4 mr-1" />
                视图
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => {
                window.dispatchEvent(new CustomEvent('editor:fitView'));
              }}>
                <Maximize2 className="w-4 h-4 mr-2" />
                适应画布
                <span className="ml-auto text-xs text-muted-foreground">Ctrl+0</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                window.dispatchEvent(new CustomEvent('editor:focusSelected'));
              }}>
                <Focus className="w-4 h-4 mr-2" />
                居中选中
                <span className="ml-auto text-xs text-muted-foreground">F</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>面板</DropdownMenuLabel>
              <DropdownMenuCheckboxItem 
                checked={panelState.nodePalette}
                onCheckedChange={() => {
                  window.dispatchEvent(new CustomEvent('editor:togglePanel', { detail: { panel: 'nodePalette' } }));
                }}
              >
                节点面板
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem 
                checked={panelState.propertyPanel}
                onCheckedChange={() => {
                  window.dispatchEvent(new CustomEvent('editor:togglePanel', { detail: { panel: 'propertyPanel' } }));
                }}
              >
                属性面板
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem 
                checked={panelState.compilerPanel}
                onCheckedChange={() => {
                  window.dispatchEvent(new CustomEvent('editor:togglePanel', { detail: { panel: 'compilerPanel' } }));
                }}
              >
                编译面板
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <div className="border-l mx-1 h-6" />
          <Button variant="outline" size="sm" onClick={() => setShowClearConfirm(true)}>
            <Trash2 className="w-4 h-4 mr-1" />
            清空
          </Button>
          <Button size="sm" onClick={handleLoadToExperiment}>
            <Upload className="w-4 h-4 mr-1" />
            加载到实验
          </Button>
        </div>
      </div>
      
      {/* YAML 预览弹窗 */}
      {yamlPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">YAML 预览</h3>
              <Button variant="ghost" size="sm" onClick={() => setYamlPreview(null)}>
                关闭
              </Button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono bg-muted/30">
              {yamlPreview}
            </pre>
            <div className="p-4 border-t flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                navigator.clipboard.writeText(yamlPreview);
              }}>
                复制
              </Button>
              <Button size="sm" onClick={() => {
                handleExportYaml();
                setYamlPreview(null);
              }}>
                下载
              </Button>
            </div>
          </div>
        </div>
      )}
      
      {/* 保存对话框 */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg shadow-xl w-96 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">{isSaveAs ? '另存为' : '保存到系统'}</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowSaveDialog(false)}>
                关闭
              </Button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">文件名</label>
                <Input
                  value={saveFilename}
                  onChange={(e) => setSaveFilename(e.target.value)}
                  placeholder="输入文件名（不含扩展名）"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  将保存为 {saveFilename || programId || 'experiment'}.yaml
                </p>
              </div>
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowSaveDialog(false)}>
                取消
              </Button>
              <Button size="sm" onClick={handleSaveDialogConfirm}>
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
      
      {/* 加载对话框 */}
      {showLoadDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg shadow-xl w-[500px] max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">打开程序</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowLoadDialog(false)}>
                关闭
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {savedPrograms.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  暂无保存的程序
                </p>
              ) : (
                <div className="space-y-2">
                  {savedPrograms.map((program) => (
                    <div
                      key={program.filename}
                      className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{program.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {program.description || '无描述'}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span className="font-mono bg-muted px-1 rounded">{program.filename}</span>
                          <span>·</span>
                          <span>v{program.version}</span>
                          <span>·</span>
                          <span>{new Date(program.updatedAt).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleLoadFromSystem(program.filename)}
                        >
                          打开
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteProgram(program.filename)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* 清空确认对话框 */}
      <ConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title="清空画布"
        description="确定要清空当前画布吗？所有节点和连接都将被删除，此操作无法撤销。"
        confirmText="清空"
        variant="destructive"
        onConfirm={() => {
          clearGraph();
          setCurrentFilename(null);
          setDirty(false);
          setShowClearConfirm(false);
        }}
      />
      
      {/* 未保存更改对话框 */}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onOpenChange={setShowUnsavedDialog}
        onSave={async () => {
          await handleSave();
          setShowUnsavedDialog(false);
          if (pendingAction) {
            pendingAction();
            setPendingAction(null);
          }
        }}
        onDiscard={() => {
          setDirty(false);
          setShowUnsavedDialog(false);
          if (pendingAction) {
            pendingAction();
            setPendingAction(null);
          }
        }}
        onCancel={() => {
          setShowUnsavedDialog(false);
          setPendingAction(null);
        }}
      />
      
      {/* 覆盖确认对话框 */}
      <ConfirmDialog
        open={showOverwriteConfirm}
        onOpenChange={setShowOverwriteConfirm}
        title="文件已存在"
        description={`文件 "${pendingSaveFilename}.yaml" 已存在。是否要覆盖？`}
        confirmText="覆盖"
        variant="destructive"
        onConfirm={handleConfirmOverwrite}
        onCancel={() => {
          setShowOverwriteConfirm(false);
          setPendingSaveFilename(null);
        }}
      />
      
      {/* 加载到实验结果对话框 */}
      <ConfirmDialog
        open={showLoadResultDialog}
        onOpenChange={setShowLoadResultDialog}
        title={
          loadResultDialogType === 'needSave' ? '需要先保存' :
          loadResultDialogType === 'confirmSave' ? '保存并加载' :
          loadResultDialogType === 'success' ? '加载成功' : '加载失败'
        }
        description={loadResultMessage}
        confirmText={
          loadResultDialogType === 'confirmSave' ? '保存并加载' :
          loadResultDialogType === 'success' ? '跳转到实验管理' : '确定'
        }
        cancelText={loadResultDialogType === 'confirmSave' ? '取消' : undefined}
        variant={loadResultDialogType === 'error' ? 'destructive' : 'default'}
        onConfirm={handleLoadResultDialogConfirm}
        onCancel={() => {
          setShowLoadResultDialog(false);
          setPendingLoadAfterSave(false);
        }}
      />
    </>
  );
}

// 面板可见性全局状态
const panelVisibility = {
  nodePalette: true,
  propertyPanel: true,
  compilerPanel: true,
};

// 获取面板可见性的函数（供 EditorToolbar 使用）
export function getPanelVisibility() {
  return { ...panelVisibility };
}

export function ExperimentEditor() {
  const [showNodePalette, setShowNodePalette] = useState(true);
  const [showPropertyPanel, setShowPropertyPanel] = useState(true);
  const [showCompilerPanel, setShowCompilerPanel] = useState(true);
  
  // 同步全局状态
  useEffect(() => {
    panelVisibility.nodePalette = showNodePalette;
    panelVisibility.propertyPanel = showPropertyPanel;
    panelVisibility.compilerPanel = showCompilerPanel;
  }, [showNodePalette, showPropertyPanel, showCompilerPanel]);
  
  // 监听面板切换事件
  useEffect(() => {
    const handleToggle = (e: Event) => {
      const { panel } = (e as CustomEvent).detail;
      if (panel === 'nodePalette') setShowNodePalette(v => !v);
      if (panel === 'propertyPanel') setShowPropertyPanel(v => !v);
      if (panel === 'compilerPanel') setShowCompilerPanel(v => !v);
    };
    window.addEventListener('editor:togglePanel', handleToggle);
    return () => window.removeEventListener('editor:togglePanel', handleToggle);
  }, []);
  
  return (
    <ReactFlowProvider>
      <div className="flex flex-col h-full">
        <EditorToolbar />
        <div className="flex flex-1 overflow-hidden">
          {showNodePalette && <NodePalette />}
          <EditorCanvas />
          {showPropertyPanel && <PropertyPanel />}
          {showCompilerPanel && (
            <div className="w-64 shrink-0">
              <CompilerPanel />
            </div>
          )}
        </div>
        <StatusBar />
      </div>
    </ReactFlowProvider>
  );
}
