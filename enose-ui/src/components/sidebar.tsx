"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Settings, FlaskConical, ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { useState } from "react";

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
    title: "服务日志",
    href: "/logs",
    icon: ScrollText,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "relative flex flex-col h-screen bg-card border-r border-border transition-all duration-300",
        collapsed ? "w-16" : "w-56"
      )}
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
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
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
    </aside>
  );
}
