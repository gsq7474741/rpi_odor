import { NextRequest, NextResponse } from "next/server";
import {
  startTraining,
  getTrainingJob,
  listTrainingJobs,
  cancelTraining,
  deleteTrainingJob,
  getTrainingEvaluation,
  getTrainingJobProgress,
  listModels,
  deleteModel,
} from "@/lib/analytics-grpc-client";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get("action");

  try {
    // 获取训练任务详情
    if (action === "job") {
      const jobId = searchParams.get("jobId");
      if (!jobId) {
        return NextResponse.json({ error: "jobId required" }, { status: 400 });
      }
      const job = await getTrainingJob({ jobId });
      return NextResponse.json({ job: jobToJson(job) });
    }

    // 列出训练任务
    if (action === "jobs" || !action) {
      const limit = parseInt(searchParams.get("limit") || "20");
      const offset = parseInt(searchParams.get("offset") || "0");
      const statusFilter = searchParams.get("status") || "";
      const response = await listTrainingJobs({ limit, offset, statusFilter });
      return NextResponse.json({
        jobs: response.jobs.map(jobToJson),
        total: response.total,
      });
    }

    // 获取训练评估
    if (action === "evaluation") {
      const jobId = searchParams.get("jobId");
      if (!jobId) {
        return NextResponse.json({ error: "jobId required" }, { status: 400 });
      }
      const response = await getTrainingEvaluation({ jobId });
      return NextResponse.json({
        evaluations: response.evaluations.map((ev) => ({
          id: ev.id,
          jobId: ev.jobId,
          modelId: ev.modelId,
          split: ev.split,
          accuracy: ev.accuracy,
          loss: ev.loss,
          f1Macro: ev.f1Macro,
          f1Weighted: ev.f1Weighted,
          precisionMacro: ev.precisionMacro,
          recallMacro: ev.recallMacro,
          r2Score: ev.r2Score,
          mse: ev.mse,
          mae: ev.mae,
          silhouetteScore: ev.silhouetteScore,
          confusionMatrix: ev.confusionMatrixJson ? JSON.parse(ev.confusionMatrixJson) : null,
          classificationReport: ev.classificationReportJson ? JSON.parse(ev.classificationReportJson) : null,
        })),
      });
    }

    // 获取训练进度历史
    if (action === "progress") {
      const jobId = searchParams.get("jobId");
      if (!jobId) {
        return NextResponse.json({ error: "jobId required" }, { status: 400 });
      }
      const response = await getTrainingJobProgress({ jobId });
      return NextResponse.json({
        entries: response.entries.map((e) => ({
          epoch: e.epoch,
          trainLoss: e.trainLoss,
          valLoss: e.valLoss,
          trainAccuracy: e.trainAccuracy,
          valAccuracy: e.valAccuracy,
        })),
      });
    }

    // 列出模型
    if (action === "models") {
      const limit = parseInt(searchParams.get("limit") || "100");
      const offset = parseInt(searchParams.get("offset") || "0");
      const response = await listModels({ limit, offset });
      return NextResponse.json({
        models: response.models.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          modelType: m.modelType,
          taskType: m.taskType,
          framework: m.framework,
          inputDim: m.inputDim,
          outputDim: m.outputDim,
          classNames: m.classNames,
          trainAccuracy: m.trainAccuracy,
          valAccuracy: m.valAccuracy,
          testAccuracy: m.testAccuracy,
          trainLoss: m.trainLoss,
          valLoss: m.valLoss,
          minioPath: m.minioPath,
          fileSize: m.fileSize,
          isLoaded: m.isLoaded,
          confusionMatrix: m.confusionMatrixJson ? JSON.parse(m.confusionMatrixJson) : null,
          extraMetrics: m.extraMetricsJson ? JSON.parse(m.extraMetricsJson) : null,
          trainingJobId: m.trainingJobId,
          createdAt: m.createdAt,
        })),
        total: response.total,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[training GET] action=${action} error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get("action");

  try {
    // 启动训练
    if (action === "start") {
      const body = await request.json();
      const response = await startTraining({
        name: body.name,
        description: body.description || "",
        modelType: body.modelType,
        taskType: body.taskType,
        labelConfigName: body.labelConfigName,
        sampleIds: body.sampleIds || [],
        runIds: body.runIds || [],
        trainRatio: body.trainRatio || 0.7,
        valRatio: body.valRatio || 0.15,
        frameNSamples: body.frameNSamples || 100,
        frameMethod: body.frameMethod || "linear",
        seed: body.seed || 42,
        hyperparamsJson: body.hyperparamsJson || JSON.stringify(body.hyperparams || {}),
      });
      return NextResponse.json({
        jobId: response.jobId,
        message: response.message,
      });
    }

    // 取消训练
    if (action === "cancel") {
      const body = await request.json();
      await cancelTraining({ jobId: body.jobId });
      return NextResponse.json({ success: true });
    }

    // 删除模型
    if (action === "deleteModel") {
      const body = await request.json();
      await deleteModel({ modelId: body.modelId });
      return NextResponse.json({ success: true });
    }

    // 删除训练任务
    if (action === "deleteJob") {
      const body = await request.json();
      await deleteTrainingJob({ jobId: body.jobId });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[training POST] action=${action} error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jobToJson(job: any) {
  return {
    id: job.id,
    modelName: job.modelName,
    modelType: job.modelType,
    taskType: job.taskType,
    status: job.status,
    currentEpoch: job.currentEpoch,
    totalEpochs: job.totalEpochs,
    trainLoss: job.trainLoss,
    valLoss: job.valLoss,
    trainAccuracy: job.trainAccuracy,
    valAccuracy: job.valAccuracy,
    testAccuracy: job.testAccuracy,
    hyperparams: job.hyperparamsJson ? JSON.parse(job.hyperparamsJson) : {},
    datasetConfig: job.datasetConfigJson ? JSON.parse(job.datasetConfigJson) : {},
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    modelId: job.modelId,
    extraMetrics: job.extraMetricsJson ? JSON.parse(job.extraMetricsJson) : {},
  };
}
