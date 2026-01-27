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
import { NodePalette } from './panels/NodePalette';
import { PropertyPanel } from './panels/PropertyPanel';
import { SelectionToolbar } from './panels/SelectionToolbar';
import { NodeType, NODE_CATEGORIES, validateDAG } from './types';
import { graphToYaml, yamlToGraph } from './yaml-converter';
import { templates } from './templates';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, FileDown, Trash2, Play, Upload, CheckCircle, LayoutTemplate, Undo2, Redo2, FolderOpen, HardDrive } from 'lucide-react';
import { Input } from '@/components/ui/input';

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
      
      // Tab: 切换到下一个连接的节点
      if (e.key === 'Tab') {
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
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clipboard, getNodes, getEdges, setNodes, setEdges, saveToHistory, undo, redo, setSelectedNodeId]);

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

  return (
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
          type: 'smoothstep',
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
  
  // 快捷键支持
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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);
  
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

  // 保存对话框确认
  const handleSaveDialogConfirm = async () => {
    const filename = saveFilename || programId || 'experiment';
    await doSave(filename);
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
        setShowLoadDialog(false);
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
          <h2 className="font-semibold">{programName || '实验编程器'}</h2>
          {currentFilename && (
            <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
              {currentFilename}
            </span>
          )}
          <Select
            onValueChange={(templateId) => {
              const template = templates.find((t) => t.id === templateId);
              if (template) {
                loadGraph(template.nodes, template.edges);
                setProgramMeta(template.programMeta);
              }
            }}
          >
            <SelectTrigger className="w-40 h-8">
              <LayoutTemplate className="w-4 h-4 mr-1" />
              <SelectValue placeholder="选择模板" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <div className="flex flex-col">
                    <span>{t.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <Button variant="outline" size="sm" onClick={() => {
            loadSavedPrograms();
            setShowLoadDialog(true);
          }}>
            <FolderOpen className="w-4 h-4 mr-1" />
            打开
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave} title={currentFilename ? `保存到 ${currentFilename}` : '保存'}>
            <HardDrive className="w-4 h-4 mr-1" />
            保存
          </Button>
          <Button variant="outline" size="sm" onClick={handleSaveAs}>
            <Save className="w-4 h-4 mr-1" />
            另存为
          </Button>
          <div className="border-l mx-1 h-6" />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-4 h-4 mr-1" />
            导入
          </Button>
          <Button variant="outline" size="sm" onClick={handlePreviewYaml}>
            <Save className="w-4 h-4 mr-1" />
            预览
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportYaml}>
            <FileDown className="w-4 h-4 mr-1" />
            导出
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            clearGraph();
            setCurrentFilename(null);
          }}>
            <Trash2 className="w-4 h-4 mr-1" />
            清空
          </Button>
          <Button variant="outline" size="sm" onClick={handleValidate}>
            <CheckCircle className="w-4 h-4 mr-1" />
            验证
          </Button>
          <Button size="sm" onClick={handleRun}>
            <Play className="w-4 h-4 mr-1" />
            运行
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
    </>
  );
}

export function ExperimentEditor() {
  return (
    <ReactFlowProvider>
      <div className="flex flex-col h-full">
        <EditorToolbar />
        <div className="flex flex-1 overflow-hidden">
          <NodePalette />
          <EditorCanvas />
          <PropertyPanel />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
