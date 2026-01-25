import { NextResponse } from 'next/server';

export async function POST() {
  try {
    // 通过 Moonraker machine API 重启主机
    const res = await fetch('http://rpi5.local:7125/machine/reboot', {
      method: 'POST',
    });
    
    if (!res.ok) {
      throw new Error(`Moonraker error: ${res.status}`);
    }
    
    return NextResponse.json({ success: true, message: 'Host reboot initiated' });
  } catch (error) {
    console.error('Host reboot error:', error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 503 }
    );
  }
}
