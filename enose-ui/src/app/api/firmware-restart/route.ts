import { NextResponse } from 'next/server';
import { firmwareRestart } from '@/lib/grpc-client';

export async function POST() {
  try {
    const result = await firmwareRestart();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Firmware restart error:', error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 503 }
    );
  }
}
