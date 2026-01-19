import { NextRequest, NextResponse } from 'next/server';
import { sendSensorCommand } from '@/lib/grpc-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { command, params } = body;

    const result = await sendSensorCommand(command, params ? JSON.stringify(params) : undefined);
    
    return NextResponse.json({
      success: result.success,
      message: result.message,
      data: result.dataJson ? JSON.parse(result.dataJson) : null
    });
  } catch (error) {
    console.error('Sensor command error:', error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 503 }
    );
  }
}
