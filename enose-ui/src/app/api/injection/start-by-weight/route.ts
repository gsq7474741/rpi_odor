import { NextRequest, NextResponse } from 'next/server';
import { startInjectionByWeight } from '@/lib/grpc-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pump0Weight, pump1Weight, pump2Weight, pump3Weight, pump4Weight, pump5Weight, pump6Weight, pump7Weight, speed, accel } = body;

    const result = await startInjectionByWeight({
      pump0Weight: pump0Weight || 0,
      pump1Weight: pump1Weight || 0,
      pump2Weight: pump2Weight || 0,
      pump3Weight: pump3Weight || 0,
      pump4Weight: pump4Weight || 0,
      pump5Weight: pump5Weight || 0,
      pump6Weight: pump6Weight || 0,
      pump7Weight: pump7Weight || 0,
      speed,
      accel,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Start injection by weight error:', error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 503 }
    );
  }
}
