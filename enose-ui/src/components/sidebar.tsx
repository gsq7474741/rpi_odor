"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Settings, FlaskConical, ChevronLeft, ChevronRight, ScrollText, Package, Workflow } from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import { useEditorStore } from "./experiment-editor/store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
}

const navItems: NavItem[] = [
  {
    title: "系统功能",
    href: "/system",
    icon: Settings,
  },
  {
    title: "实验管理",
    href: "/experiment",
    icon: FlaskConical,
  },
  {
    title: "实验编程",
    href: "/experiment-editor",
    icon: Workflow,
  },
  {
    title: "耗材管理",
    href: "/consumables",
    icon: Package,
  },
  {
    title: "服务日志",
    href: "/logs",
    icon: ScrollText,
  },
];

const MIN_WIDTH = 56;
const MAX_WIDTH = 320;
const DEFAULT_WIDTH = 224;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const { isDirty, setDirty } = useEditorStore();
  
  // 未保存更改对话框状态
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const handleNavigation = (href: string, e: React.MouseEvent) => {
    // 如果当前在实验编辑器页面且有未保存更改
    if (pathname.startsWith('/experiment-editor') && isDirty && href !== pathname) {
      e.preventDefault();
      setPendingHref(href);
      setShowUnsavedDialog(true);
    }
  };
  
  const handleDiscardAndNavigate = () => {
    setDirty(false);
    setShowUnsavedDialog(false);
    if (pendingHref) {
      router.push(pendingHref);
      setPendingHref(null);
    }
  };

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing && sidebarRef.current) {
      const newWidth = e.clientX - sidebarRef.current.getBoundingClientRect().left;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth);
        // 如果宽度小于阈值，自动折叠
        if (newWidth < 100) {
          setCollapsed(true);
        } else {
          setCollapsed(false);
        }
      }
    }
  }, [isResizing]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  const actualWidth = collapsed ? MIN_WIDTH : width;

  return (
    <aside
      ref={sidebarRef}
      className={cn(
        "relative flex flex-col h-full bg-card border-r border-border",
        isResizing ? "" : "transition-all duration-300"
      )}
      style={{ width: actualWidth }}
    >
      {/* Header */}
      <div className={cn(
        "flex items-center h-14 px-4 border-b border-border",
        collapsed ? "justify-center" : "justify-between"
      )}>
        {!collapsed && (
          <h1 className="text-lg font-semibold text-foreground">电子鼻系统</h1>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/' && pathname.startsWith(item.href + '/'));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={(e) => handleNavigation(item.href, e)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
                collapsed && "justify-center px-2"
              )}
              title={collapsed ? item.title : undefined}
            >
              <Icon size={20} />
              {!collapsed && <span className="font-medium">{item.title}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={cn(
        "p-4 border-t border-border text-xs text-muted-foreground",
        collapsed && "text-center"
      )}>
        {collapsed ? "v0.1" : "版本 0.1.0"}
      </div>
      
      {/* 拖拽调整宽度的手柄 */}
      <div
        className={cn(
          "absolute top-0 right-0 w-1 h-full cursor-ew-resize hover:bg-primary/20 active:bg-primary/40 transition-colors",
          isResizing && "bg-primary/40"
        )}
        onMouseDown={startResizing}
      />
      
      {/* 未保存更改对话框 */}
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>未保存的更改</AlertDialogTitle>
            <AlertDialogDescription>
              当前实验有未保存的更改。您想要离开吗？未保存的更改将会丢失。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowUnsavedDialog(false);
              setPendingHref(null);
            }}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDiscardAndNavigate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              不保存，离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
