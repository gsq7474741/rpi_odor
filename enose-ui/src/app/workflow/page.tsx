'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, Suspense } from 'react';
import { ExperimentEditor } from '@/components/experiment-editor';

function EditorWithParams() {
  const searchParams = useSearchParams();
  const fileToOpen = searchParams.get('file');
  
  useEffect(() => {
    if (!fileToOpen) return;
    
    const loadFile = () => {
      window.dispatchEvent(new CustomEvent('editor:loadFile', { detail: { filename: fileToOpen } }));
    };
    
    window.addEventListener('editor:ready', loadFile, { once: true });
    window.dispatchEvent(new CustomEvent('editor:requestLoad', { detail: { filename: fileToOpen } }));
    
    return () => window.removeEventListener('editor:ready', loadFile);
  }, [fileToOpen]);
  
  return <ExperimentEditor />;
}

export default function WorkflowPage() {
  return (
    <div className="h-[calc(100vh-4rem)]">
      <Suspense fallback={<div className="flex items-center justify-center h-full">加载中...</div>}>
        <EditorWithParams />
      </Suspense>
    </div>
  );
}
