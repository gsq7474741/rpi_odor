// 前端 API 客户端 (调用 Next.js API Routes)

export interface PeripheralStatus {
  valveWaste: number;
  valvePinch: number;
  valveAir: number;
  valveOutlet: number;
  airPumpPwm: number;
  cleaningPump: number;
  pump0: number;  // 0=UNSPECIFIED, 1=STOPPED, 2=RUNNING
  pump1: number;
  pump2: number;
  pump3: number;
  pump4: number;
  pump5: number;
  pump6: number;
  pump7: number;
  heaterChamber: number;
  sensorChamberTemp?: number;
  scaleWeight?: number;
}

export interface SystemStatus {
  currentState: number;  // 0=UNSPECIFIED, 1=INITIAL, 2=DRAIN, 3=CLEAN, 4=SAMPLE, 5=INJECT
  peripheralStatus: PeripheralStatus;
  moonrakerConnected: boolean;
  sensorConnected: boolean;
  firmwareReady: boolean;
}

export async function fetchStatus(): Promise<SystemStatus> {
  const res = await fetch("/api/status");
  if (!res.ok) {
    throw new Error("Failed to fetch status");
  }
  return res.json();
}

export async function setSystemState(targetState: "INITIAL" | "DRAIN" | "CLEAN" | "SAMPLE" | "INJECT"): Promise<any> {
  const res = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_state: targetState }),
  });
  if (!res.ok) {
    throw new Error("Failed to set state");
  }
  return res.json();
}

export async function manualControl(peripheralName: string, value: number): Promise<any> {
  const res = await fetch("/api/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ peripheral_name: peripheralName, value }),
  });
  if (!res.ok) {
    throw new Error("Failed to control peripheral");
  }
  return res.json();
}

export async function runPump(
  pumpName: string, 
  speed: number, 
  distance?: number, 
  accel?: number
): Promise<any> {
  const res = await fetch("/api/pump", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pump_name: pumpName, speed, distance, accel }),
  });
  if (!res.ok) {
    throw new Error("Failed to run pump");
  }
  return res.json();
}

export async function stopAllPumps(): Promise<any> {
  const res = await fetch("/api/pump", {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error("Failed to stop pumps");
  }
  return res.json();
}
