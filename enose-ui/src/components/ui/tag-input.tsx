"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Tag {
  id: number;
  name: string;
  category?: string;
  usageCount?: number;
}

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestions?: Tag[];
  onInputChange?: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

export function TagInput({
  value,
  onChange,
  placeholder = "输入标签...",
  suggestions = [],
  onInputChange,
  className,
  disabled = false,
}: TagInputProps) {
  const [inputValue, setInputValue] = React.useState("");
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // 过滤掉已选择的标签
  const filteredSuggestions = suggestions.filter(
    (s) => !value.includes(s.name)
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onInputChange?.(newValue);
    setShowSuggestions(true);
  };

  const handleFocus = () => {
    // 获得焦点时加载最近使用的标签（空前缀）
    onInputChange?.("");
    setShowSuggestions(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === "，" || e.key === "、") {
      e.preventDefault();
      addTag(inputValue.trim());
    } else if (e.key === "Backspace" && inputValue === "" && value.length > 0) {
      // 删除最后一个标签
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const addTag = (tag: string) => {
    if (tag && !value.includes(tag)) {
      onChange([...value, tag]);
    }
    setInputValue("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const removeTag = (tagToRemove: string) => {
    onChange(value.filter((t) => t !== tagToRemove));
  };

  const handleSuggestionClick = (suggestion: Tag) => {
    addTag(suggestion.name);
  };

  // 点击外部关闭建议列表
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div
        className={cn(
          "flex flex-wrap gap-1.5 p-2 border rounded-md bg-background min-h-[38px]",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        onClick={() => !disabled && inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="text-xs px-2 py-0.5 gap-1"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                className="ml-1 rounded-full p-0.5 hover:bg-destructive/20 focus:outline-none"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removeTag(tag);
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <X className="h-3 w-3 cursor-pointer hover:text-destructive" />
              </button>
            )}
          </Badge>
        ))}
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder={value.length === 0 ? placeholder : ""}
          disabled={disabled}
          className="flex-1 min-w-[120px] border-0 p-0 h-6 focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>

      {/* 建议列表 */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-auto">
          {filteredSuggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="px-3 py-2 cursor-pointer hover:bg-accent flex items-center justify-between"
              onClick={() => handleSuggestionClick(suggestion)}
            >
              <span className="text-sm">{suggestion.name}</span>
              {suggestion.usageCount !== undefined && suggestion.usageCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  使用 {suggestion.usageCount} 次
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
