import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const PROGRAMS_DIR = path.join(process.cwd(), "public", "programs");

// 确保目录存在
function ensureDir() {
  if (!fs.existsSync(PROGRAMS_DIR)) {
    fs.mkdirSync(PROGRAMS_DIR, { recursive: true });
  }
}

// 文件名安全过滤：支持中文、英文、数字、下划线、连字符、点，只过滤路径分隔符和特殊字符
function sanitizeFilename(name: string): string {
  // 移除路径分隔符和特殊控制字符
  return name.replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').trim();
}

// 路径穿越防护：确保最终路径在 PROGRAMS_DIR 内
function safePath(filename: string): string | null {
  const resolved = path.resolve(PROGRAMS_DIR, filename);
  if (!resolved.startsWith(path.resolve(PROGRAMS_DIR))) {
    return null; // 路径穿越
  }
  return resolved;
}

// 获取程序列表
export async function GET(request: NextRequest) {
  try {
    ensureDir();
    
    const { searchParams } = new URL(request.url);
    const filename = searchParams.get("filename");
    const checkExists = searchParams.get("checkExists");
    
    // 检查文件是否存在
    if (checkExists) {
      const safeName = sanitizeFilename(checkExists);
      const finalName = safeName.endsWith(".yaml") ? safeName : `${safeName}.yaml`;
      const filePath = safePath(finalName);
      if (!filePath) {
        return NextResponse.json({ exists: false });
      }
      return NextResponse.json({ exists: fs.existsSync(filePath) });
    }
    
    // 如果指定了文件名，返回文件内容
    if (filename) {
      const filePath = safePath(filename);
      if (!filePath) {
        return NextResponse.json({ error: "无效文件名" }, { status: 400 });
      }
      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: "文件不存在" }, { status: 404 });
      }
      const content = fs.readFileSync(filePath, "utf-8");
      return NextResponse.json({ content });
    }
    
    // 否则返回列表
    const files = fs.readdirSync(PROGRAMS_DIR).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
    
    const programs = files.map(file => {
      const filePath = path.join(PROGRAMS_DIR, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const stats = fs.statSync(filePath);
      
      // 简单解析 YAML 头部信息
      const idMatch = content.match(/^id:\s*(.+)$/m);
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      const descMatch = content.match(/^description:\s*(.+)$/m);
      const versionMatch = content.match(/^version:\s*(.+)$/m);
      
      return {
        id: idMatch?.[1]?.trim() || file.replace(/\.ya?ml$/, ""),
        name: nameMatch?.[1]?.trim() || file,
        description: descMatch?.[1]?.trim() || "",
        version: versionMatch?.[1]?.trim() || "1.0.0",
        filename: file,
        updatedAt: stats.mtime.toISOString(),
      };
    });
    
    // 按更新时间排序
    programs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    
    return NextResponse.json({ programs });
  } catch (error: unknown) {
    console.error("Error loading programs:", error);
    return NextResponse.json({ programs: [], error: error instanceof Error ? error.message : "未知错误" }, { status: 500 });
  }
}

// 保存程序
export async function POST(request: NextRequest) {
  try {
    ensureDir();
    
    const { filename, content } = await request.json();
    
    if (!filename || !content) {
      return NextResponse.json({ error: "缺少文件名或内容" }, { status: 400 });
    }
    
    // 确保文件名安全（支持中文）
    const safeName = sanitizeFilename(filename);
    const finalName = safeName.endsWith(".yaml") ? safeName : `${safeName}.yaml`;
    
    const filePath = safePath(finalName);
    if (!filePath) {
      return NextResponse.json({ error: "无效文件名" }, { status: 400 });
    }
    fs.writeFileSync(filePath, content, "utf-8");
    
    return NextResponse.json({ success: true, filename: finalName });
  } catch (error: unknown) {
    console.error("Error saving program:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 500 });
  }
}

// 删除程序
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filename = searchParams.get("filename");
    
    if (!filename) {
      return NextResponse.json({ error: "缺少文件名" }, { status: 400 });
    }
    
    const filePath = safePath(filename);
    if (!filePath) {
      return NextResponse.json({ error: "无效文件名" }, { status: 400 });
    }
    
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }
    
    fs.unlinkSync(filePath);
    
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Error deleting program:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 500 });
  }
}
