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
import { TabBar } from './panels/TabBar';
import { CompilerPanel } from './panels/CompilerPanel';
import { StatusBar } from './panels/StatusBar';
import { NodeType, NODE_CATEGORIES } from './types';
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { Save, FileDown, Trash2, Upload, LayoutTemplate, Undo2, Redo2, FolderOpen, HardDrive, ChevronDown, FilePlus, Maximize2, Focus, FileText, Eye, ArrowUpFromLine, Search, ArrowUpDown, Clock, File, Menu } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ConfirmDialog, UnsavedChangesDialog } from './ConfirmDialog';
import { EditorContextMenu } from './panels/ContextMenu';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

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
      
      // 注意：Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y 已在 EditorToolbar 中统一处理，此处不再重复注册
      
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
          
          // 通知 store 同步 nodeIdCounter
          useEditorStore.setState({ isRecordingHistory: true });
          setNodes(nodes => [...nodes.map(n => ({ ...n, selected: false })), ...newNodes]);
          setEdges(edges => [...edges, ...newEdges]);
          queueMicrotask(() => useEditorStore.setState({ isRecordingHistory: false }));
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
          
          // 使用 isRecordingHistory 防止 onNodesChange/onEdgesChange 重复记录
          useEditorStore.setState({ isRecordingHistory: true });
          setNodes(nodes => nodes.filter(n => !selectedIds.has(n.id)));
          setEdges(edges => edges.filter(e => !selectedIds.has(e.source) && !selectedIds.has(e.target)));
          queueMicrotask(() => useEditorStore.setState({ isRecordingHistory: false }));
        }
      }
      
      // Delete/Backspace: 由 React Flow 的 deleteKeyCode 处理，
      // onNodesChange/onEdgesChange 会自动记录历史
      
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
      useEditorStore.setState({ isRecordingHistory: true });
      setNodes(nodes => nodes.filter(n => !selectedIds.has(n.id)));
      setEdges(edges => edges.filter(e => !selectedIds.has(e.source) && !selectedIds.has(e.target)));
      queueMicrotask(() => useEditorStore.setState({ isRecordingHistory: false }));
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
      
      useEditorStore.setState({ isRecordingHistory: true });
      setNodes(nodes => [...nodes.map(n => ({ ...n, selected: false })), ...newNodes]);
      setEdges(edges => [...edges, ...newEdges]);
      queueMicrotask(() => useEditorStore.setState({ isRecordingHistory: false }));
    }
  }, [clipboard, getNodes, saveToHistory, setNodes, setEdges]);

  const handleContextDelete = useCallback(() => {
    const selectedNodesList = getNodes().filter(n => n.selected);
    if (selectedNodesList.length > 0) {
      saveToHistory();
      const selectedIds = new Set(selectedNodesList.map(n => n.id));
      useEditorStore.setState({ isRecordingHistory: true });
      setNodes(nodes => nodes.filter(n => !selectedIds.has(n.id)).map(node => {
        const data = node.data as Record<string, unknown>;
        const bound = data.boundVariables as Record<string, string> | undefined;
        if (!bound) return node;
        const cleaned: Record<string, string> = {};
        let changed = false;
        for (const [field, sweepId] of Object.entries(bound)) {
          if (selectedIds.has(sweepId)) {
            changed = true;
          } else {
            cleaned[field] = sweepId;
          }
        }
        if (!changed) return node;
        return { ...node, data: { ...data, boundVariables: Object.keys(cleaned).length > 0 ? cleaned : undefined } };
      }));
      setEdges(edges => edges.filter(e => !selectedIds.has(e.source) && !selectedIds.has(e.target)));
      queueMicrotask(() => useEditorStore.setState({ isRecordingHistory: false }));
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
    compilationResult,  // 获取编译结果用于 YAML 生成
    recompile,
    resetHistory,
    markSaved,
    createTab,
    switchTab,
    closeTab,
    tabs,
    activeTabId,
    updateActiveTabSnapshot,
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
      // 如果焦点在输入框中，只处理 Ctrl+S，不处理其他快捷键
      const inInput = (e.target as HTMLElement).tagName === 'INPUT' || 
                      (e.target as HTMLElement).tagName === 'TEXTAREA';
      
      // Ctrl+S 保存（始终处理）
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSaveRef.current();
        return;
      }
      
      if (inInput) return;
      
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
      // Ctrl+N 新建
      if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        handleNewRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);
  
  const { isDirty, setDirty, currentFilename, setCurrentFilename } = useEditorStore();
  
  // beforeunload 警告：任何标签有未保存更改时防止意外关闭
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useEditorStore.getState();
      const anyDirty = s.isDirty || s.tabs.some(t => t.isDirty);
      if (anyDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [yamlPreview, setYamlPreview] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [saveFilename, setSaveFilename] = useState('');
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
  
  // 监听从 URL 参数加载文件事件（适配多标签）
  useEffect(() => {
    const handleLoadFile = async (e: Event) => {
      const { filename } = (e as CustomEvent).detail;
      if (filename) {
        // 检查是否已在某个标签打开
        const s = useEditorStore.getState();
        const existingTab = s.tabs.find(t => t.filename === filename);
        if (existingTab) {
          switchTab(existingTab.id);
          addToRecentFiles(filename);
          return;
        }
        
        try {
          const res = await fetch(`/api/run/programs?filename=${encodeURIComponent(filename)}`);
          const data = await res.json();
          if (data.content) {
            const { nodes: newNodes, edges: newEdges, programMeta } = yamlToGraph(data.content);
            
            // 如果当前标签是空白的，复用；否则新建标签
            const cur = useEditorStore.getState();
            const isCurrentEmpty = !cur.isDirty && !cur.currentFilename && cur.nodes.length <= 2;
            if (!isCurrentEmpty) {
              createTab();
            }
            
            loadGraph(newNodes, newEdges);
            setProgramMeta(programMeta);
            setCurrentFilename(filename);
            setDirty(false);
            resetHistory();
            addToRecentFiles(filename);
          }
        } catch (error) {
          console.error('加载文件失败:', error);
        }
      }
    };
    
    // 处理 page.tsx 的 requestLoad 事件（编辑器已就绪时的竞态处理）
    const handleRequestLoad = (e: Event) => {
      const { filename } = (e as CustomEvent).detail;
      if (filename) {
        handleLoadFile(new CustomEvent('editor:loadFile', { detail: { filename } }));
      }
    };
    
    window.addEventListener('editor:loadFile', handleLoadFile);
    window.addEventListener('editor:requestLoad', handleRequestLoad);
    
    // 通知 page.tsx 编辑器已就绪
    window.dispatchEvent(new CustomEvent('editor:ready'));
    
    return () => {
      window.removeEventListener('editor:loadFile', handleLoadFile);
      window.removeEventListener('editor:requestLoad', handleRequestLoad);
    };
  }, [loadGraph, setProgramMeta, resetHistory, switchTab, createTab]);
  
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
  
  // 草稿恢复对话框状态
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [draftData, setDraftData] = useState<{ nodes: any; edges: any; programMeta: any; savedTime: string } | null>(null);
  
  // 启动时检查是否有草稿
  useEffect(() => {
    const stored = localStorage.getItem('experiment-editor-draft');
    if (!stored) return;
    try {
      const draft = JSON.parse(stored);
      // 过期草稿（>1小时）直接清除
      if (Date.now() - draft.savedAt >= 3600000) {
        localStorage.removeItem('experiment-editor-draft');
        return;
      }
      // 只在初始状态（空画布）时提示恢复
      if (nodes.length <= 2) {
        const savedTime = new Date(draft.savedAt).toLocaleString();
        setDraftData({
          nodes: draft.nodes,
          edges: draft.edges,
          programMeta: draft.programMeta,
          savedTime,
        });
        setShowDraftDialog(true);
      }
    } catch {
      localStorage.removeItem('experiment-editor-draft');
    }
  }, []); // 只在组件挂载时运行一次

  // 从文件名派生程序标识符
  const getProgramIdFromFilename = () => {
    return currentFilename?.replace(/\.ya?ml$/i, '') || 'new_experiment';
  };

  const handleExportYaml = async () => {
    try {
      // 确保编译结果是最新的（await 等待完成）
      if (!compilationResult) {
        await recompile();
      }
      const latestResult = useEditorStore.getState().compilationResult;
      const derivedProgramId = getProgramIdFromFilename();
      const yaml = graphToYaml(nodes, edges, {
        programId: derivedProgramId,
        programName: derivedProgramId,
        programDescription,
        programVersion,
        bottleCapacityMl,
        maxFillMl,
      }, latestResult || undefined);
      
      // 下载 YAML 文件
      const blob = new Blob([yaml], { type: 'text/yaml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${derivedProgramId}.yaml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('导出失败:', error);
      toast.error('导出失败', { description: error instanceof Error ? error.message : '未知错误' });
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
        // 在新标签页中打开导入的文件
        createTab();
        loadGraph(newNodes, newEdges);
        setProgramMeta(programMeta);
        setCurrentFilename(null); // 导入的文件未保存到系统
        setDirty(true); // 标记为未保存
        resetHistory();
      } catch (error) {
        console.error('导入失败:', error);
        toast.error('导入失败', { description: error instanceof Error ? error.message : '未知错误' });
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
      const res = await fetch('/api/run/programs');
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
      await doSave(currentFilename.replace(/\.ya?ml$/i, ''));
    } else {
      // 没有当前文件，显示另存为对话框
      setIsSaveAs(false);
      setSaveFilename('new_experiment');
      setShowSaveDialog(true);
    }
  };

  // 另存为
  const handleSaveAs = () => {
    setIsSaveAs(true);
    setSaveFilename(currentFilename?.replace(/\.ya?ml$/i, '') || 'new_experiment');
    setShowSaveDialog(true);
  };

  // 新建文档（在新标签页中打开）
  const handleNew = () => {
    createTab();
  };
  
  // 更新快捷键回调 ref
  useEffect(() => {
    handleSaveRef.current = handleSave;
    handleNewRef.current = handleNew;
  });

  // 监听"保存并关闭标签页"事件
  useEffect(() => {
    const handleSaveAndClose = async (e: Event) => {
      const { tabId } = (e as CustomEvent).detail;
      await handleSave();
      // 保存成功后关闭标签
      if (!useEditorStore.getState().isDirty) {
        closeTab(tabId);
      }
    };
    window.addEventListener('editor:saveAndCloseTab', handleSaveAndClose);
    return () => window.removeEventListener('editor:saveAndCloseTab', handleSaveAndClose);
  }, [closeTab]);

  // 执行保存
  const doSave = async (filename: string) => {
    try {
      // 保存前确保编译结果是最新的
      if (!compilationResult) {
        await recompile();
      }
      const latestResult = useEditorStore.getState().compilationResult;
      // 使用文件名作为 programId 和 programName
      const yaml = graphToYaml(nodes, edges, {
        programId: filename,
        programName: filename,
        programDescription,
        programVersion,
        bottleCapacityMl,
        maxFillMl,
      }, latestResult || undefined);
      
      const res = await fetch('/api/run/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content: yaml }),
      });
      
      const data = await res.json();
      if (data.success) {
        setCurrentFilename(data.filename);
        setShowSaveDialog(false);
        setSaveFilename('');
        markSaved(); // 保存后标记保存点，清除未保存状态
        updateActiveTabSnapshot(); // 同步标签快照
        localStorage.removeItem('experiment-editor-draft');
        toast.success(`已保存到 ${data.filename}`);
        addToRecentFiles(data.filename);
      } else {
        toast.error('保存失败', { description: data.error });
      }
    } catch (error) {
      toast.error('保存失败', { description: error instanceof Error ? error.message : '未知错误' });
    }
  };

  // 检查文件是否存在
  const checkFileExists = async (filename: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/run/programs?checkExists=${encodeURIComponent(filename)}`);
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

  // 从系统加载（在新标签页打开，或切换到已打开的标签）
  const handleLoadFromSystem = async (filename: string) => {
    // 检查是否已经在某个标签中打开
    const existingTab = tabs.find(t => t.filename === filename);
    if (existingTab) {
      // 先快照当前标签，再切换
      switchTab(existingTab.id);
      setShowLoadDialog(false);
      return;
    }
    
    try {
      const res = await fetch(`/api/run/programs?filename=${encodeURIComponent(filename)}`);
      const data = await res.json();
      
      if (data.content) {
        const { nodes: newNodes, edges: newEdges, programMeta } = yamlToGraph(data.content);
        
        // 如果当前标签是空白的未修改标签，复用它；否则新建标签
        const isCurrentEmpty = !isDirty && !currentFilename && nodes.length <= 2;
        
        if (isCurrentEmpty) {
          // 复用当前标签
          loadGraph(newNodes, newEdges);
          setProgramMeta(programMeta);
          setCurrentFilename(filename);
          setDirty(false);
          resetHistory();
        } else {
          // 新建标签
          createTab();
          loadGraph(newNodes, newEdges);
          setProgramMeta(programMeta);
          setCurrentFilename(filename);
          setDirty(false);
          resetHistory();
        }
        
        setShowLoadDialog(false);
        addToRecentFiles(filename);
      } else {
        toast.error('加载失败', { description: data.error || '未知错误' });
      }
    } catch (error) {
      toast.error('加载失败', { description: error instanceof Error ? error.message : '未知错误' });
    }
  };

  // 删除确认对话框状态
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDeleteFilename, setPendingDeleteFilename] = useState<string | null>(null);
  
  // 删除保存的程序
  const handleDeleteProgram = (filename: string) => {
    setPendingDeleteFilename(filename);
    setShowDeleteConfirm(true);
  };
  
  const doDeleteProgram = async () => {
    if (!pendingDeleteFilename) return;
    try {
      const res = await fetch(`/api/run/programs?filename=${encodeURIComponent(pendingDeleteFilename)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`已删除 ${pendingDeleteFilename}`);
        loadSavedPrograms();
      } else {
        toast.error('删除失败', { description: data.error });
      }
    } catch (error) {
      toast.error('删除失败', { description: error instanceof Error ? error.message : '未知错误' });
    }
    setShowDeleteConfirm(false);
    setPendingDeleteFilename(null);
  };

  const handlePreviewYaml = () => {
    try {
      const derivedProgramId = getProgramIdFromFilename();
      const yaml = graphToYaml(nodes, edges, {
        programId: derivedProgramId,
        programName: derivedProgramId,
        programDescription,
        programVersion,
        bottleCapacityMl,
        maxFillMl,
      }, compilationResult || undefined);
      setYamlPreview(yaml);
    } catch (error) {
      toast.error('预览失败', { description: error instanceof Error ? error.message : '未知错误' });
    }
  };

  const handleLoadToExperiment = async () => {
    // 必须先保存才能加载
    if (!currentFilename) {
      setLoadResultDialogType('needSave');
      setLoadResultMessage('请先保存文件后再加载到执行。\n\n点击"文件 → 保存"或使用 Ctrl+S。');
      setShowLoadResultDialog(true);
      return;
    }
    
    // 如果有未保存的更改，提示保存
    if (isDirty) {
      setLoadResultDialogType('confirmSave');
      setLoadResultMessage('有未保存的更改，是否先保存后再加载到执行？');
      setPendingLoadAfterSave(true);
      setShowLoadResultDialog(true);
      return;
    }
    
    // 直接加载程序到后端并跳转
    await doLoadToExperiment();
  };
  
  const doLoadToExperiment = async () => {
    if (!currentFilename) return;
    
    try {
      // 0. 检查编译器是否有错误（本地快速拦截，避免无意义的网络请求）
      if (compilationResult && !compilationResult.success) {
        const errors = compilationResult.diagnostics
          .filter(d => d.level === 'error')
          .map(d => d.message);
        setLoadResultDialogType('error');
        setLoadResultMessage(`编译器检测到错误，请先修复：\n\n${errors.map(e => `• ${e}`).join('\n')}`);
        setShowLoadResultDialog(true);
        return;
      }
      
      // 以文件为唯一信源，直接传文件名给后端
      // 后端会从磁盘读取 YAML 文件并发送给 gRPC 服务
      const loadRes = await fetch('/api/run?action=load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: currentFilename }),
      });
      
      const loadData = await loadRes.json();
      if (!loadData.success) {
        setLoadResultDialogType('error');
        setLoadResultMessage(`加载失败: ${loadData.errorMessage || '未知错误'}`);
        setShowLoadResultDialog(true);
        return;
      }
      
      // 加载成功，跳转到实验执行页面
      setLoadResultDialogType('success');
      setLoadResultMessage('程序已加载成功！\n\n点击确定跳转到实验执行页面。');
      setShowLoadResultDialog(true);
    } catch (error) {
      setLoadResultDialogType('error');
      setLoadResultMessage(`加载失败: ${error instanceof Error ? error.message : '网络错误'}`);
      setShowLoadResultDialog(true);
    }
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
      }, compilationResult || undefined);
      
      try {
        const saveRes = await fetch('/api/run/programs', {
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
        markSaved();
        setShowLoadResultDialog(false);
        // 保存成功后执行加载
        await doLoadToExperiment();
      } catch (error) {
        setLoadResultDialogType('error');
        setLoadResultMessage(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    } else if (loadResultDialogType === 'success') {
      // 加载成功，跳转到实验执行页面
      setShowLoadResultDialog(false);
      window.location.href = '/run';
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
      }, compilationResult || undefined);
      
      // 先加载程序
      const loadRes = await fetch('/api/run?action=load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml_content: yaml }),
      });
      
      const loadData = await loadRes.json();
      if (!loadData.success) {
        toast.error('加载失败', { description: loadData.errorMessage || '未知错误' });
        return;
      }
      
      // 启动实验
      const startRes = await fetch('/api/run?action=start', {
        method: 'POST',
      });
      
      const startData = await startRes.json();
      if (startData.state === 3) { // EXP_RUNNING
        toast.success('实验已启动', { description: '请在实验执行页面查看进度' });
        window.open('/run', '_blank');
      } else {
        toast.error('启动失败', { description: startData.message || '未知错误' });
      }
    } catch (error) {
      toast.error('运行失败', { description: error instanceof Error ? error.message : '网络错误' });
    }
  };

  // 加载对话框搜索和排序
  const [loadSearch, setLoadSearch] = useState('');
  const [loadSortBy, setLoadSortBy] = useState<'name' | 'date'>('date');
  
  const filteredPrograms = useMemo(() => {
    let list = [...savedPrograms];
    if (loadSearch) {
      const q = loadSearch.toLowerCase();
      list = list.filter(p => 
        p.name.toLowerCase().includes(q) || 
        p.filename.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (loadSortBy === 'date') return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    return list;
  }, [savedPrograms, loadSearch, loadSortBy]);

  return (
    <>
      <div className="flex items-center px-3 py-1.5 border-b bg-muted/30 gap-2">
        {/* 左侧：文件菜单 + 撤销/重做 */}
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml"
            onChange={handleImportYaml}
            className="hidden"
          />
          
          {/* 统一文件菜单 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 font-normal">
                文件
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuItem onClick={handleNew}>
                <FilePlus className="w-4 h-4 mr-2" />
                新建
                <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <LayoutTemplate className="w-4 h-4 mr-2" />
                  从模板新建
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {templates.map((t, index) => (
                    <DropdownMenuItem
                      key={`template-${t.id}-${index}`}
                      onClick={() => {
                        createTab();
                        loadGraph(t.nodes, t.edges);
                        setProgramMeta(t.programMeta);
                        setCurrentFilename(null);
                        setDirty(false);
                        resetHistory();
                      }}
                    >
                      <LayoutTemplate className="w-4 h-4 mr-2" />
                      <div>
                        <div>{t.name}</div>
                        <div className="text-xs text-muted-foreground">{t.description}</div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => {
                loadSavedPrograms();
                setLoadSearch('');
                setShowLoadDialog(true);
              }}>
                <FolderOpen className="w-4 h-4 mr-2" />
                打开...
                <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
              </DropdownMenuItem>
              {recentFiles.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Clock className="w-4 h-4 mr-2" />
                    最近打开
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {recentFiles.map((filename, index) => (
                      <DropdownMenuItem
                        key={`recent-${filename}-${index}`}
                        onClick={() => handleLoadFromSystem(filename)}
                      >
                        <File className="w-4 h-4 mr-2" />
                        <span className="truncate">{filename}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSave}>
                <Save className="w-4 h-4 mr-2" />
                {currentFilename ? '保存' : '保存...'}
                <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSaveAs}>
                <Save className="w-4 h-4 mr-2" />
                另存为...
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => {
                fileInputRef.current?.click();
              }}>
                <Upload className="w-4 h-4 mr-2" />
                导入 YAML...
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportYaml}>
                <FileDown className="w-4 h-4 mr-2" />
                导出 YAML
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handlePreviewYaml}>
                <Eye className="w-4 h-4 mr-2" />
                预览 YAML
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={() => setShowClearConfirm(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                清空画布
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          {/* 视图菜单 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 font-normal">
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
                <DropdownMenuShortcut>Ctrl+0</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                window.dispatchEvent(new CustomEvent('editor:focusSelected'));
              }}>
                <Focus className="w-4 h-4 mr-2" />
                居中选中
                <DropdownMenuShortcut>F</DropdownMenuShortcut>
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
          
          <div className="border-l mx-1 h-5" />
          
          {/* 撤销/重做 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={undo} disabled={!canUndo()}>
                <Undo2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>撤销 (Ctrl+Z)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={redo} disabled={!canRedo()}>
                <Redo2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>重做 (Ctrl+Shift+Z)</TooltipContent>
          </Tooltip>
        </div>
        
        {/* 中间：占位（文件名已通过标签栏显示） */}
        <div className="flex-1" />
        
        {/* 右侧：操作按钮 */}
        <div className="flex items-center gap-1.5">
          <Button size="sm" className="h-7" onClick={handleLoadToExperiment}>
            <ArrowUpFromLine className="w-4 h-4 mr-1" />
            加载到执行
          </Button>
        </div>
      </div>
      
      {/* === 以下为 Dialog / AlertDialog 弹窗 === */}
      
      {/* YAML 预览 Dialog */}
      <Dialog open={!!yamlPreview} onOpenChange={(open) => { if (!open) setYamlPreview(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>YAML 预览</DialogTitle>
            <DialogDescription>
              {currentFilename || programName || '未命名'} 的编译输出
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 max-h-[55vh] rounded-md border bg-muted/30">
            <pre className="p-4 text-xs font-mono whitespace-pre">
              {yamlPreview}
            </pre>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => {
              if (yamlPreview) {
                navigator.clipboard.writeText(yamlPreview);
                toast.success('已复制到剪贴板');
              }
            }}>
              复制
            </Button>
            <Button size="sm" onClick={() => {
              handleExportYaml();
              setYamlPreview(null);
            }}>
              下载
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 保存 Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isSaveAs ? '另存为' : '保存'}</DialogTitle>
            <DialogDescription>输入文件名保存到系统</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">文件名</label>
              <Input
                value={saveFilename}
                onChange={(e) => setSaveFilename(e.target.value)}
                placeholder="输入文件名（不含扩展名）"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveDialogConfirm(); }}
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                将保存为 <span className="font-mono">{saveFilename || programId || 'experiment'}.yaml</span>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowSaveDialog(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleSaveDialogConfirm}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 加载 Dialog（带搜索和排序） */}
      <Dialog open={showLoadDialog} onOpenChange={setShowLoadDialog}>
        <DialogContent className="sm:max-w-lg max-h-[75vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>打开程序</DialogTitle>
            <DialogDescription>从已保存的程序中选择</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索..."
                value={loadSearch}
                onChange={(e) => setLoadSearch(e.target.value)}
                className="pl-8 h-9"
                autoFocus
              />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-2.5"
                  onClick={() => setLoadSortBy(s => s === 'date' ? 'name' : 'date')}
                >
                  <ArrowUpDown className="w-4 h-4 mr-1" />
                  {loadSortBy === 'date' ? '时间' : '名称'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>切换排序方式</TooltipContent>
            </Tooltip>
          </div>
          <ScrollArea className="flex-1 max-h-[45vh] -mx-6 px-6">
            {filteredPrograms.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                {loadSearch ? '无匹配结果' : '暂无保存的程序'}
              </p>
            ) : (
              <div className="space-y-1.5">
                {filteredPrograms.map((program) => (
                  <div
                    key={program.filename}
                    className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer group"
                    onClick={() => handleLoadFromSystem(program.filename)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{program.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono">{program.filename}</span>
                        <span>·</span>
                        <span>v{program.version}</span>
                        <span>·</span>
                        <span>{new Date(program.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProgram(program.filename);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
      
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
          resetHistory();
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
      
      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="删除程序"
        description={`确定要删除 "${pendingDeleteFilename}" 吗？此操作无法撤销。`}
        confirmText="删除"
        variant="destructive"
        onConfirm={doDeleteProgram}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setPendingDeleteFilename(null);
        }}
      />
      
      {/* 草稿恢复对话框 */}
      <ConfirmDialog
        open={showDraftDialog}
        onOpenChange={setShowDraftDialog}
        title="发现自动保存的草稿"
        description={draftData ? `上次自动保存于 ${draftData.savedTime}，是否恢复？` : ''}
        confirmText="恢复"
        cancelText="不恢复"
        onConfirm={() => {
          if (draftData) {
            loadGraph(draftData.nodes, draftData.edges);
            setProgramMeta(draftData.programMeta);
            setDirty(true);
            resetHistory();
            localStorage.removeItem('experiment-editor-draft');
          }
          setShowDraftDialog(false);
          setDraftData(null);
        }}
        onCancel={() => {
          localStorage.removeItem('experiment-editor-draft');
          setShowDraftDialog(false);
          setDraftData(null);
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
          loadResultDialogType === 'success' ? '跳转到实验执行' : '确定'
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
  
  const { createTab, closeTab, switchTab, tabs, activeTabId } = useEditorStore();
  
  // 关闭标签页（带未保存检查）
  const [showCloseTabDialog, setShowCloseTabDialog] = useState(false);
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  
  const handleCloseTab = useCallback((tabId: string, isDirty: boolean) => {
    if (tabs.length <= 1) return;
    if (isDirty) {
      setPendingCloseTabId(tabId);
      setShowCloseTabDialog(true);
    } else {
      closeTab(tabId);
    }
  }, [tabs.length, closeTab]);
  
  const handleCloseOtherTabs = useCallback((keepTabId: string) => {
    // 先快照当前标签再切换
    const store = useEditorStore.getState();
    store.updateActiveTabSnapshot();
    switchTab(keepTabId);
    
    // 重新读取最新的 tabs（快照后）
    const latestTabs = useEditorStore.getState().tabs;
    const dirtyCount = latestTabs.filter(t => t.id !== keepTabId && t.isDirty).length;
    const cleanIds = latestTabs.filter(t => t.id !== keepTabId && !t.isDirty).map(t => t.id);
    
    for (const id of cleanIds) {
      closeTab(id);
    }
    
    if (dirtyCount > 0) {
      toast.info(`${dirtyCount} 个标签有未保存更改，未关闭`);
    }
  }, [switchTab, closeTab]);
  
  const handleNewTab = useCallback(() => {
    createTab();
  }, [createTab]);
  
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
        <TabBar
          onNewTab={handleNewTab}
          onCloseTab={handleCloseTab}
          onCloseOtherTabs={handleCloseOtherTabs}
        />
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* 左侧节点面板 */}
          {showNodePalette && (
            <>
              <ResizablePanel defaultSize={12} minSize={8} maxSize={20}>
                <NodePalette />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}
          
          {/* 中间画布 */}
          <ResizablePanel defaultSize={showPropertyPanel && showCompilerPanel ? 52 : showPropertyPanel || showCompilerPanel ? 68 : 88}>
            <EditorCanvas />
          </ResizablePanel>
          
          {/* 右侧属性面板 */}
          {showPropertyPanel && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={18} minSize={12} maxSize={30}>
                <PropertyPanel />
              </ResizablePanel>
            </>
          )}
          
          {/* 最右侧编译器面板 */}
          {showCompilerPanel && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={18} minSize={12} maxSize={35}>
                <CompilerPanel />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
        <StatusBar />
        
        {/* 关闭标签页时的未保存确认对话框 */}
        <UnsavedChangesDialog
          open={showCloseTabDialog}
          onOpenChange={setShowCloseTabDialog}
          onSave={async () => {
            // 如果要关闭的标签不是当前标签，先切换过去
            if (pendingCloseTabId && pendingCloseTabId !== activeTabId) {
              switchTab(pendingCloseTabId);
            }
            // 触发保存（通过事件让 EditorToolbar 处理）
            window.dispatchEvent(new CustomEvent('editor:saveAndCloseTab', { detail: { tabId: pendingCloseTabId } }));
            setShowCloseTabDialog(false);
            setPendingCloseTabId(null);
          }}
          onDiscard={() => {
            if (pendingCloseTabId) {
              closeTab(pendingCloseTabId);
            }
            setShowCloseTabDialog(false);
            setPendingCloseTabId(null);
          }}
          onCancel={() => {
            setShowCloseTabDialog(false);
            setPendingCloseTabId(null);
          }}
        />
      </div>
    </ReactFlowProvider>
  );
}
