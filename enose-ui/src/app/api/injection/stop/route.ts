import { NextResponse } from 'next/server';
import { stopInjection } from '@/lib/grpc-client';

export async function POST() {
  try {
    const result = await stopInjection();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Stop injection error:', error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 503 }
    );
  }
}
