'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, Suspense } from 'react';
import { ExperimentEditor } from '@/components/experiment-editor';

function EditorWithParams() {
  const searchParams = useSearchParams();
  const fileToOpen = searchParams.get('file');
  
  useEffect(() => {
    if (fileToOpen) {
      // 延迟触发加载事件，确保编辑器已初始化
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('editor:loadFile', { detail: { filename: fileToOpen } }));
      }, 500);
    }
  }, [fileToOpen]);
  
  return <ExperimentEditor />;
}

export default function ExperimentEditorPage() {
  return (
    <div className="h-[calc(100vh-4rem)]">
      <Suspense fallback={<div className="flex items-center justify-center h-full">加载中...</div>}>
        <EditorWithParams />
      </Suspense>
    </div>
  );
}
