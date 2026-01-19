// 前端 API 客户端 (调用 Next.js API Routes)

export interface PeripheralStatus {
  valve_waste: number;
  valve_pinch: number;
  valve_air: number;
  valve_outlet: number;
  air_pump_pwm: number;
  cleaning_pump: number;
  pump_2: "STOPPED" | "RUNNING";
  pump_3: "STOPPED" | "RUNNING";
  pump_4: "STOPPED" | "RUNNING";
  pump_5: "STOPPED" | "RUNNING";
  heater_chamber: number;
  sensor_chamber_temp?: number;
  scale_weight?: number;
}

export interface SystemStatus {
  current_state: "INITIAL" | "DRAIN" | "CLEAN" | "UNSPECIFIED";
  peripheral_status: PeripheralStatus;
  moonraker_connected: boolean;
  sensor_connected: boolean;
}

export async function fetchStatus(): Promise<SystemStatus> {
  const res = await fetch("/api/status");
  if (!res.ok) {
    throw new Error("Failed to fetch status");
  }
  const data = await res.json();
  
  // 转换 gRPC 响应格式
  return {
    current_state: data.current_state === 1 ? "INITIAL" : 
                   data.current_state === 2 ? "DRAIN" : 
                   data.current_state === 3 ? "CLEAN" : "UNSPECIFIED",
    peripheral_status: {
      valve_waste: data.peripheral_status?.valve_waste || 0,
      valve_pinch: data.peripheral_status?.valve_pinch || 0,
      valve_air: data.peripheral_status?.valve_air || 0,
      valve_outlet: data.peripheral_status?.valve_outlet || 0,
      air_pump_pwm: data.peripheral_status?.air_pump_pwm || 0,
      cleaning_pump: data.peripheral_status?.cleaning_pump || 0,
      pump_2: data.peripheral_status?.pump_2 === 1 ? "RUNNING" : "STOPPED",
      pump_3: data.peripheral_status?.pump_3 === 1 ? "RUNNING" : "STOPPED",
      pump_4: data.peripheral_status?.pump_4 === 1 ? "RUNNING" : "STOPPED",
      pump_5: data.peripheral_status?.pump_5 === 1 ? "RUNNING" : "STOPPED",
      heater_chamber: data.peripheral_status?.heater_chamber || 0,
      sensor_chamber_temp: data.peripheral_status?.sensor_chamber_temp,
      scale_weight: data.peripheral_status?.scale_weight,
    },
    moonraker_connected: data.moonraker_connected || false,
    sensor_connected: data.sensor_connected || false,
  };
}

export async function setSystemState(targetState: "INITIAL" | "DRAIN" | "CLEAN"): Promise<any> {
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
