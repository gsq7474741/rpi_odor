import { NextResponse } from 'next/server';

const ALLOWED_SERVICES = ['klipper', 'moonraker', 'enose-control'];

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const service = searchParams.get('service');
    
    if (!service || !ALLOWED_SERVICES.includes(service)) {
      return NextResponse.json(
        { success: false, message: `Invalid service. Allowed: ${ALLOWED_SERVICES.join(', ')}` },
        { status: 400 }
      );
    }
    
    // 通过 Moonraker machine API 重启服务
    const res = await fetch(`http://rpi5.local:7125/machine/services/restart?service=${service}`, {
      method: 'POST',
    });
    
    if (!res.ok) {
      throw new Error(`Moonraker error: ${res.status}`);
    }
    
    return NextResponse.json({ success: true, message: `${service} restart initiated` });
  } catch (error) {
    console.error('Service restart error:', error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 503 }
    );
  }
}
