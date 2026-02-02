"use client";

import * as React from "react";
import { ImagePlus, X, Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Attachment {
  id: number;
  liquidId: number;
  fieldKey: string;
  fileType: string;
  fileName: string;
  filePath: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
}

interface ImageInputProps {
  liquidId?: number;
  fieldKey: string;
  value?: Attachment[];
  onChange?: (attachments: Attachment[]) => void;
  onUpload?: (file: File) => Promise<Attachment | null>;
  onDelete?: (attachmentId: number) => Promise<boolean>;
  className?: string;
  disabled?: boolean;
  maxImages?: number;
}

export function ImageInput({
  liquidId,
  fieldKey,
  value = [],
  onChange,
  onUpload,
  onDelete,
  className,
  disabled = false,
  maxImages = 1,
}: ImageInputProps) {
  const [uploading, setUploading] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUpload) return;

    setUploading(true);
    try {
      const attachment = await onUpload(file);
      if (attachment) {
        const newValue = [...value, attachment];
        onChange?.(newValue);
      }
    } catch (error) {
      console.error("上传失败:", error);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDelete = async (attachmentId: number) => {
    if (!onDelete) return;
    
    const success = await onDelete(attachmentId);
    if (success) {
      const newValue = value.filter((a) => a.id !== attachmentId);
      onChange?.(newValue);
    }
  };

  const canAddMore = value.length < maxImages;

  return (
    <div className={cn("space-y-2", className)}>
      {/* 已上传的图片 */}
      <div className="flex flex-wrap gap-2">
        {value.map((attachment) => (
          <div
            key={attachment.id}
            className="relative group w-20 h-20 rounded-md overflow-hidden border bg-muted"
          >
            <img
              src={attachment.fileUrl}
              alt={attachment.fileName}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-white hover:bg-white/20"
                    onClick={() => setPreviewUrl(attachment.fileUrl)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl">
                  <img
                    src={attachment.fileUrl}
                    alt={attachment.fileName}
                    className="w-full h-auto"
                  />
                </DialogContent>
              </Dialog>
              {!disabled && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-white hover:bg-red-500/50"
                  onClick={() => handleDelete(attachment.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))}

        {/* 上传按钮 */}
        {canAddMore && !disabled && (
          <label
            className={cn(
              "w-20 h-20 rounded-md border-2 border-dashed flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors",
              uploading && "pointer-events-none opacity-50"
            )}
          >
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <>
                <ImagePlus className="h-6 w-6 text-muted-foreground" />
                <span className="text-xs text-muted-foreground mt-1">上传</span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
              disabled={disabled || uploading}
            />
          </label>
        )}
      </div>

      {/* 无图片时的提示 */}
      {value.length === 0 && disabled && (
        <div className="text-sm text-muted-foreground">暂无图片</div>
      )}
    </div>
  );
}

// 表格中使用的图片预览按钮
export function ImagePreviewButton({
  attachments,
  className,
}: {
  attachments: Attachment[];
  className?: string;
}) {
  if (attachments.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className={cn("gap-1", className)}>
          <Eye className="h-4 w-4" />
          查看 ({attachments.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <div className="grid gap-4">
          {attachments.map((att) => (
            <div key={att.id} className="space-y-2">
              <img
                src={att.fileUrl}
                alt={att.fileName}
                className="w-full h-auto rounded-md"
              />
              <p className="text-sm text-muted-foreground">{att.fileName}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
