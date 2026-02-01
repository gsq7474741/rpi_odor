import { NextRequest, NextResponse } from "next/server";
import { 
  listHeaterProfiles, 
  getHeaterProfile, 
  createHeaterProfile, 
  updateHeaterProfile, 
  deleteHeaterProfile,
  type HeaterProfile 
} from "@/lib/grpc-client";

// GET /api/heater-profiles - 列出所有加热器预设
// GET /api/heater-profiles?id=1 - 获取指定预设
// GET /api/heater-profiles?name=xxx - 获取指定名称的预设
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const name = searchParams.get("name");
    
    if (id) {
      const profile = await getHeaterProfile(parseInt(id));
      if (!profile) {
        return NextResponse.json({ error: "Profile not found" }, { status: 404 });
      }
      return NextResponse.json(profile);
    }
    
    if (name) {
      const profile = await getHeaterProfile(name);
      if (!profile) {
        return NextResponse.json({ error: "Profile not found" }, { status: 404 });
      }
      return NextResponse.json(profile);
    }
    
    const profiles = await listHeaterProfiles();
    return NextResponse.json(profiles);
  } catch (error) {
    console.error("Error fetching heater profiles:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST /api/heater-profiles - 创建新预设
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const profile = await createHeaterProfile(body as Omit<HeaterProfile, 'id'>);
    return NextResponse.json(profile, { status: 201 });
  } catch (error) {
    console.error("Error creating heater profile:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// PUT /api/heater-profiles - 更新预设
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const profile = await updateHeaterProfile(body as HeaterProfile);
    return NextResponse.json(profile);
  } catch (error) {
    console.error("Error updating heater profile:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("PERMISSION_DENIED")) {
      return NextResponse.json({ error: "Cannot modify builtin profile" }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/heater-profiles?id=1 - 删除预设
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    
    if (!id) {
      return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
    }
    
    await deleteHeaterProfile(parseInt(id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting heater profile:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("PERMISSION_DENIED")) {
      return NextResponse.json({ error: "Cannot delete builtin profile" }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
