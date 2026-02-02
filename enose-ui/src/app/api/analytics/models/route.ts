import { NextRequest, NextResponse } from "next/server";
import { listModels } from "@/lib/analytics-grpc-client";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    const response = await listModels({ limit, offset });

    // 转换响应格式
    const models = response.models.map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description,
      inputDim: model.inputDim,
      outputDim: model.outputDim,
      classNames: model.classNames,
      trainAccuracy: model.trainAccuracy,
      valAccuracy: model.valAccuracy,
      trainLoss: model.trainLoss,
      valLoss: model.valLoss,
      createdAt: model.createdAt
        ? new Date(Number(model.createdAt.seconds) * 1000).toISOString()
        : undefined,
      minioPath: model.minioPath,
      fileSize: Number(model.fileSize),
      isLoaded: model.isLoaded,
      config: model.config
        ? {
            hiddenLayers: model.config.hiddenLayers,
            activation: model.config.activation,
            dropout: model.config.dropout,
          }
        : undefined,
    }));

    return NextResponse.json({ models, total: response.total });
  } catch (error) {
    console.error("Failed to fetch models:", error);
    return NextResponse.json(
      { error: "Failed to fetch models" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Model name is required" },
        { status: 400 }
      );
    }

    // TODO: 实现 TrainModel gRPC 流式调用
    // 目前返回未实现提示
    return NextResponse.json(
      { error: "Model training not implemented yet" },
      { status: 501 }
    );
  } catch (error) {
    console.error("Failed to train model:", error);
    return NextResponse.json(
      { error: "Failed to train model" },
      { status: 500 }
    );
  }
}
