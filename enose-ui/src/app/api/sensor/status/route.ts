import { NextResponse } from 'next/server';
import { getSensorStatus } from '@/lib/grpc-client';

export async function GET() {
  try {
    const status = await getSensorStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error('Get sensor status error:', error);
    return NextResponse.json(
      { connected: false, running: false, sensorCount: 0, firmwareVersion: '', port: '' },
      { status: 503 }
    );
  }
}
