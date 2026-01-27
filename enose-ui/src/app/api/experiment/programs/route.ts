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

// 获取程序列表
export async function GET(request: NextRequest) {
  try {
    ensureDir();
    
    const { searchParams } = new URL(request.url);
    const filename = searchParams.get("filename");
    
    // 如果指定了文件名，返回文件内容
    if (filename) {
      const filePath = path.join(PROGRAMS_DIR, filename);
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
    
    // 确保文件名安全
    const safeName = filename.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
    const finalName = safeName.endsWith(".yaml") ? safeName : `${safeName}.yaml`;
    
    const filePath = path.join(PROGRAMS_DIR, finalName);
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
    
    const filePath = path.join(PROGRAMS_DIR, filename);
    
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
