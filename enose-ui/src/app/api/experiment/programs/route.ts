import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// 获取内置程序列表
export async function GET() {
  try {
    const programsDir = path.join(process.cwd(), "public", "programs");
    
    if (!fs.existsSync(programsDir)) {
      return NextResponse.json({ programs: [] });
    }
    
    const files = fs.readdirSync(programsDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
    
    const programs = files.map(file => {
      const filePath = path.join(programsDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      
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
      };
    });
    
    return NextResponse.json({ programs });
  } catch (error: any) {
    console.error("Error loading programs:", error);
    return NextResponse.json({ programs: [], error: error.message }, { status: 500 });
  }
}
