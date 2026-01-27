import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const ALLOWED_SERVICES = ['klipper', 'moonraker', 'enose-control'];
const SSH_HOST = process.env.SSH_HOST || 'rpi5.local';
const SSH_USER = process.env.SSH_USER || 'user';
const SSH_PASSWORD = process.env.SSH_PASSWORD || '123456';

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
    
    // 对于 klipper 和 moonraker，尝试使用 Moonraker API
    if (service === 'klipper' || service === 'moonraker') {
      try {
        const res = await fetch(`http://${SSH_HOST}:7125/machine/services/restart?service=${service}`, {
          method: 'POST',
        });
        if (res.ok) {
          return NextResponse.json({ success: true, message: `${service} restart initiated via Moonraker` });
        }
      } catch {
        // Moonraker API 失败，使用 SSH 方式
      }
    }
    
    // 使用 SSH 直接重启服务
    const sshCommand = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${SSH_USER}@${SSH_HOST} "echo ${SSH_PASSWORD} | sudo -S systemctl restart ${service}"`;
    
    await execAsync(sshCommand, { timeout: 15000 });
    
    return NextResponse.json({ success: true, message: `${service} restart initiated via SSH` });
  } catch (error) {
    console.error('Service restart error:', error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 503 }
    );
  }
}
