import { NextRequest, NextResponse } from 'next/server';
import { startInjection } from '@/lib/grpc-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pump2Volume, pump3Volume, pump4Volume, pump5Volume, speed, accel } = body;

    const result = await startInjection({
      pump2Volume: pump2Volume || 0,
      pump3Volume: pump3Volume || 0,
      pump4Volume: pump4Volume || 0,
      pump5Volume: pump5Volume || 0,
      speed,
      accel,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Start injection error:', error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 503 }
    );
  }
}
