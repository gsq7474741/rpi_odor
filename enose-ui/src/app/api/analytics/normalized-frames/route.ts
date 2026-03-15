import { NextResponse } from "next/server";

// [DEPRECATED] run_id based normalized frames API
// Frames are now auto-generated on demand via sample_id based APIs (sample-frames route)

export async function GET() {
  return NextResponse.json({
    exists: false,
    totalFrames: 0,
    meta: [],
    deprecated: "Use sample-based frame APIs instead",
  });
}

export async function POST() {
  return NextResponse.json({
    success: false,
    message: "Deprecated: use sample-based frame generation (GenerateSampleFrames) instead",
    framesGenerated: {},
  });
}
