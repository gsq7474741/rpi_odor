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
  current_state: "INITIAL" | "DRAIN" | "CLEAN" | "SAMPLE" | "INJECT" | "UNSPECIFIED";
  peripheral_status: PeripheralStatus;
  moonraker_connected: boolean;
  sensor_connected: boolean;
  firmware_ready: boolean;
}

export async function fetchStatus(): Promise<SystemStatus> {
  const res = await fetch("/api/status");
  if (!res.ok) {
    throw new Error("Failed to fetch status");
  }
  const data = await res.json();
  
  // 转换 gRPC 响应格式 (protobuf-ts 使用 camelCase)
  const ps = data.peripheralStatus;
  return {
    current_state: data.currentState === 1 ? "INITIAL" : 
                   data.currentState === 2 ? "DRAIN" : 
                   data.currentState === 3 ? "CLEAN" : 
                   data.currentState === 4 ? "SAMPLE" : 
                   data.currentState === 5 ? "INJECT" : "UNSPECIFIED",
    peripheral_status: {
      valve_waste: ps?.valveWaste || 0,
      valve_pinch: ps?.valvePinch || 0,
      valve_air: ps?.valveAir || 0,
      valve_outlet: ps?.valveOutlet || 0,
      air_pump_pwm: ps?.airPumpPwm || 0,
      cleaning_pump: ps?.cleaningPump || 0,
      pump_2: ps?.pump2 === 2 ? "RUNNING" : "STOPPED",
      pump_3: ps?.pump3 === 2 ? "RUNNING" : "STOPPED",
      pump_4: ps?.pump4 === 2 ? "RUNNING" : "STOPPED",
      pump_5: ps?.pump5 === 2 ? "RUNNING" : "STOPPED",
      heater_chamber: ps?.heaterChamber || 0,
      sensor_chamber_temp: ps?.sensorChamberTemp,
      scale_weight: ps?.scaleWeight,
    },
    moonraker_connected: data.moonrakerConnected || false,
    sensor_connected: data.sensorConnected || false,
    firmware_ready: data.firmwareReady !== false,  // default true
  };
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
