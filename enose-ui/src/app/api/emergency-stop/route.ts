import { NextResponse } from 'next/server';
import { emergencyStop } from '@/lib/grpc-client';

export async function POST() {
  try {
    const result = await emergencyStop();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Emergency stop error:', error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 503 }
    );
  }
}
