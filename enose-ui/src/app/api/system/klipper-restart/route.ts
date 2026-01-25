import { NextResponse } from 'next/server';

export async function POST() {
  try {
    // 通过 Moonraker API 重启 Klipper
    const res = await fetch('http://rpi5.local:7125/printer/restart', {
      method: 'POST',
    });
    
    if (!res.ok) {
      throw new Error(`Moonraker error: ${res.status}`);
    }
    
    return NextResponse.json({ success: true, message: 'Klipper restart initiated' });
  } catch (error) {
    console.error('Klipper restart error:', error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 503 }
    );
  }
}
