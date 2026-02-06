import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import path from "path";

const DEFAULTS_PATH = path.join(process.cwd(), "config", "system-defaults.json");

const FALLBACK_DEFAULTS = {
  wash: {
    fillTimeoutS: 60,
    drainTimeoutS: 60,
    emptyToleranceG: 10,
    emptyStabilityWindowS: 2,
    gasPumpPwm: 50,
    washVolumeMl: 20,
    repeatCount: 2,
  },
};

export async function GET() {
  try {
    const raw = await readFile(DEFAULTS_PATH, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json(FALLBACK_DEFAULTS);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    await writeFile(DEFAULTS_PATH, JSON.stringify(body, null, 2), "utf-8");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to save defaults", details: error.message },
      { status: 500 }
    );
  }
}
