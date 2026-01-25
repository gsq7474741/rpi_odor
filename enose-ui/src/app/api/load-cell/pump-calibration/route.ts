import { NextRequest, NextResponse } from 'next/server';
import { setPumpCalibration } from '@/lib/grpc-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { slope, offset } = body;

    if (typeof slope !== 'number' || typeof offset !== 'number') {
      return NextResponse.json(
        { success: false, message: 'slope and offset must be numbers' },
        { status: 400 }
      );
    }

    await setPumpCalibration(slope, offset);

    return NextResponse.json({ success: true, message: 'Pump calibration saved' });
  } catch (error) {
    console.error('Set pump calibration error:', error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 503 }
    );
  }
}
