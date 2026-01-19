import { NextResponse } from 'next/server';
import * as grpc from "@grpc/grpc-js";
import { getSensorClient } from "@/lib/grpc-client";
import { Empty } from "@/generated/google/protobuf/empty";

export async function GET() {
  try {
    const client = getSensorClient();
    
    return new Promise((resolve) => {
      const stream = client.subscribeSensorReadings(Empty.create());
      let readings: Array<{
        timestamp: number;
        sensorIndex: number;
        temperature: number;
        humidity: number;
        pressure: number;
        gasResistance: number;
        gasIndex: number;
      }> = [];
      
      const timeout = setTimeout(() => {
        stream.cancel();
        resolve(NextResponse.json({ readings }));
      }, 200);
      
      stream.on('data', (reading) => {
        readings.push({
          timestamp: Number(reading.tickMs),
          sensorIndex: reading.sensorIdx,
          temperature: reading.temperature,
          humidity: reading.humidity,
          pressure: reading.pressure,
          gasResistance: reading.value,
          gasIndex: reading.heaterStep,
        });
      });
      
      stream.on('error', (err: grpc.ServiceError) => {
        clearTimeout(timeout);
        if (err.code !== grpc.status.CANCELLED) {
          console.error('Stream error:', err);
        }
        resolve(NextResponse.json({ readings }));
      });
      
      stream.on('end', () => {
        clearTimeout(timeout);
        resolve(NextResponse.json({ readings }));
      });
    });
  } catch (error) {
    console.error('Get sensor readings error:', error);
    return NextResponse.json({ readings: [] }, { status: 503 });
  }
}
