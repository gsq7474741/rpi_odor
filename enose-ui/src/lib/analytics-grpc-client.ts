import * as grpc from "@grpc/grpc-js";
import { AnalyticsServiceClient, LabelServiceClient, ModelServiceClient, DataServiceClient, SampleServiceClient, MLLabelServiceClient, ExportServiceClient } from "../generated/enose_analytics.grpc-client";
import { Empty } from "../generated/google/protobuf/empty";
import type {
  VisualizationRequest,
  VisualizationResponse,
  QualityConfig,
  ListLabelsRequest,
  ListLabelsResponse,
  CreateLabelRequest,
  UpdateLabelRequest,
  DeleteLabelRequest,
  SampleLabel,
  BatchLabelRequest,
  BatchLabelResponse,
  ListModelsRequest,
  ListModelsResponse,
  GetModelRequest,
  ModelInfo,
  LoadModelRequest,
  DeleteModelRequest,
  ListExperimentsRequest,
  ListExperimentsResponse,
  QuerySensorDataRequest,
  QuerySensorDataResponse,
  AggregatedStatsRequest,
  AggregatedStatsResponse,
  GetExperimentDetailRequest,
  ExperimentDetail,
  NormalizedFramesStatusRequest,
  NormalizedFramesStatusResponse,
  GenerateNormalizedFramesRequest,
  GenerateNormalizedFramesResponse,
  ListSamplesRequest,
  ListSamplesResponse,
  GetSampleRequest,
  Sample,
  GetSampleGroupsRequest,
  GetSampleGroupsResponse,
  SampleFramesStatusRequest,
  SampleFramesStatusResponse,
  BatchSampleFramesStatusRequest,
  BatchSampleFramesStatusResponse,
  GenerateSampleFramesRequest,
  GenerateSampleFramesResponse,
  BatchGenerateSampleFramesRequest,
  BatchGenerateSampleFramesResponse,
  GetSampleFramesRequest,
  GetSampleFramesResponse,
  GetAvailablePhasesRequest,
  GetAvailablePhasesResponse,
  GetPhaseTransitionsRequest,
  GetPhaseTransitionsResponse,
  ListMLLabelConfigsRequest,
  ListMLLabelConfigsResponse,
  GetMLLabelConfigRequest,
  MLLabelConfig,
  GenerateLabelsRequest,
  GenerateLabelsResponse,
  GetLabelDistributionRequest,
  GetLabelDistributionResponse,
  GetSampleMLLabelsRequest,
  GetSampleMLLabelsResponse,
  PreviewDatasetRequest,
  PreviewDatasetResponse,
  ExportDataRequest,
  ExportDataChunk,
  StartTrainingRequest,
  StartTrainingResponse,
  GetTrainingJobRequest,
  TrainingJobInfo,
  ListTrainingJobsRequest,
  ListTrainingJobsResponse,
  CancelTrainingRequest,
  DeleteTrainingJobRequest,
  StreamTrainingProgressRequest,
  TrainingProgressUpdate,
  GetTrainingEvaluationRequest,
  GetTrainingEvaluationResponse,
  GetTrainingJobProgressRequest,
  GetTrainingJobProgressResponse,
} from "../generated/enose_analytics";

// Analytics gRPC 服务器地址 (从环境变量读取，默认与控制服务同机)
const ANALYTICS_GRPC_HOST = process.env.ANALYTICS_GRPC_HOST || process.env.GRPC_HOST || "rpi5.local";
const ANALYTICS_GRPC_PORT = process.env.ANALYTICS_GRPC_PORT || "50052";

// gRPC channel 选项：快速重连 + keepalive
const CHANNEL_OPTIONS: grpc.ChannelOptions = {
  "grpc.keepalive_time_ms": 10000,
  "grpc.keepalive_timeout_ms": 5000,
  "grpc.keepalive_permit_without_calls": 1,
  "grpc.initial_reconnect_backoff_ms": 500,
  "grpc.max_reconnect_backoff_ms": 5000,
  "grpc.min_reconnect_backoff_ms": 250,
};

// 创建客户端实例
let analyticsClient: AnalyticsServiceClient | null = null;
let labelClient: LabelServiceClient | null = null;
let modelClient: ModelServiceClient | null = null;
let dataClient: DataServiceClient | null = null;
let sampleClient: SampleServiceClient | null = null;
let mlLabelClientCached: MLLabelServiceClient | null = null;
let exportClientCached: ExportServiceClient | null = null;

function resetAllAnalyticsClients() {
  analyticsClient?.close();
  labelClient?.close();
  modelClient?.close();
  dataClient?.close();
  sampleClient?.close();
  mlLabelClientCached?.close();
  exportClientCached?.close();
  analyticsClient = null;
  labelClient = null;
  modelClient = null;
  dataClient = null;
  sampleClient = null;
  mlLabelClientCached = null;
  exportClientCached = null;
}

function getAnalyticsClient(): AnalyticsServiceClient {
  if (!analyticsClient) {
    analyticsClient = new AnalyticsServiceClient(
      `${ANALYTICS_GRPC_HOST}:${ANALYTICS_GRPC_PORT}`,
      grpc.credentials.createInsecure(),
      CHANNEL_OPTIONS
    );
  }
  return analyticsClient;
}

function getLabelClient(): LabelServiceClient {
  if (!labelClient) {
    labelClient = new LabelServiceClient(
      `${ANALYTICS_GRPC_HOST}:${ANALYTICS_GRPC_PORT}`,
      grpc.credentials.createInsecure(),
      CHANNEL_OPTIONS
    );
  }
  return labelClient;
}

function getModelClient(): ModelServiceClient {
  if (!modelClient) {
    modelClient = new ModelServiceClient(
      `${ANALYTICS_GRPC_HOST}:${ANALYTICS_GRPC_PORT}`,
      grpc.credentials.createInsecure(),
      CHANNEL_OPTIONS
    );
  }
  return modelClient;
}

// 辅助函数：将 callback 转为 Promise
function analyticsPromisify<TReq, TRes>(
  client: AnalyticsServiceClient,
  method: (input: TReq, callback: (err: grpc.ServiceError | null, value?: TRes) => void) => grpc.ClientUnaryCall,
  request: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    method.call(client, request, (error: grpc.ServiceError | null, response?: TRes) => {
      if (error) {
        reject(error);
      } else {
        resolve(response!);
      }
    });
  });
}

function labelPromisify<TReq, TRes>(
  client: LabelServiceClient,
  method: (input: TReq, callback: (err: grpc.ServiceError | null, value?: TRes) => void) => grpc.ClientUnaryCall,
  request: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    method.call(client, request, (error: grpc.ServiceError | null, response?: TRes) => {
      if (error) {
        reject(error);
      } else {
        resolve(response!);
      }
    });
  });
}

function modelPromisify<TReq, TRes>(
  client: ModelServiceClient,
  method: (input: TReq, callback: (err: grpc.ServiceError | null, value?: TRes) => void) => grpc.ClientUnaryCall,
  request: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    method.call(client, request, (error: grpc.ServiceError | null, response?: TRes) => {
      if (error) {
        reject(error);
      } else {
        resolve(response!);
      }
    });
  });
}

// ============================================================
// Analytics Service API
// ============================================================

export async function getVisualization(request: VisualizationRequest): Promise<VisualizationResponse> {
  const client = getAnalyticsClient();
  return analyticsPromisify(
    client,
    client.getVisualization.bind(client),
    request
  );
}

export async function getQualityConfig(): Promise<QualityConfig> {
  const client = getAnalyticsClient();
  return analyticsPromisify(
    client,
    client.getQualityConfig.bind(client),
    Empty.create()
  );
}

export async function updateQualityConfig(config: QualityConfig): Promise<QualityConfig> {
  const client = getAnalyticsClient();
  return analyticsPromisify(
    client,
    client.updateQualityConfig.bind(client),
    config
  );
}

export async function getNormalizedFramesStatus(request: NormalizedFramesStatusRequest): Promise<NormalizedFramesStatusResponse> {
  const client = getAnalyticsClient();
  return analyticsPromisify(
    client,
    client.getNormalizedFramesStatus.bind(client),
    request
  );
}

export async function generateNormalizedFrames(request: GenerateNormalizedFramesRequest): Promise<GenerateNormalizedFramesResponse> {
  const client = getAnalyticsClient();
  return analyticsPromisify(
    client,
    client.generateNormalizedFrames.bind(client),
    request
  );
}

// ============================================================
// Label Service API
// ============================================================

export async function listLabels(request: ListLabelsRequest): Promise<ListLabelsResponse> {
  const client = getLabelClient();
  return labelPromisify(
    client,
    client.listLabels.bind(client),
    request
  );
}

export async function createLabel(request: CreateLabelRequest): Promise<SampleLabel> {
  const client = getLabelClient();
  return labelPromisify(
    client,
    client.createLabel.bind(client),
    request
  );
}

export async function updateLabel(request: UpdateLabelRequest): Promise<SampleLabel> {
  const client = getLabelClient();
  return labelPromisify(
    client,
    client.updateLabel.bind(client),
    request
  );
}

export async function deleteLabel(request: DeleteLabelRequest): Promise<Empty> {
  const client = getLabelClient();
  return labelPromisify(
    client,
    client.deleteLabel.bind(client),
    request
  );
}

export async function batchLabel(request: BatchLabelRequest): Promise<BatchLabelResponse> {
  const client = getLabelClient();
  return labelPromisify(
    client,
    client.batchLabel.bind(client),
    request
  );
}

// ============================================================
// Model Service API
// ============================================================

export async function listModels(request: ListModelsRequest): Promise<ListModelsResponse> {
  const client = getModelClient();
  return modelPromisify(
    client,
    client.listModels.bind(client),
    request
  );
}

export async function getModel(request: GetModelRequest): Promise<ModelInfo> {
  const client = getModelClient();
  return modelPromisify(
    client,
    client.getModel.bind(client),
    request
  );
}

export async function loadModel(request: LoadModelRequest): Promise<Empty> {
  const client = getModelClient();
  return modelPromisify(
    client,
    client.loadModel.bind(client),
    request
  );
}

export async function unloadModel(): Promise<Empty> {
  const client = getModelClient();
  return modelPromisify(
    client,
    client.unloadModel.bind(client),
    Empty.create()
  );
}

export async function deleteModel(request: DeleteModelRequest): Promise<Empty> {
  const client = getModelClient();
  return modelPromisify(
    client,
    client.deleteModel.bind(client),
    request
  );
}

// ── Training Platform API ──

export async function startTraining(request: StartTrainingRequest): Promise<StartTrainingResponse> {
  const client = getModelClient();
  return modelPromisify(
    client,
    client.startTraining.bind(client),
    request
  );
}

export async function getTrainingJob(request: GetTrainingJobRequest): Promise<TrainingJobInfo> {
  const client = getModelClient();
  return modelPromisify(
    client,
    client.getTrainingJob.bind(client),
    request
  );
}

export async function listTrainingJobs(request: ListTrainingJobsRequest): Promise<ListTrainingJobsResponse> {
  const client = getModelClient();
  return modelPromisify(
    client,
    client.listTrainingJobs.bind(client),
    request
  );
}

export async function cancelTraining(request: CancelTrainingRequest): Promise<Empty> {
  const client = getModelClient();
  return modelPromisify(
    client,
    client.cancelTraining.bind(client),
    request
  );
}

export async function deleteTrainingJob(request: DeleteTrainingJobRequest): Promise<Empty> {
  const client = getModelClient();
  return modelPromisify(
    client,
    client.deleteTrainingJob.bind(client),
    request
  );
}

export async function getTrainingEvaluation(request: GetTrainingEvaluationRequest): Promise<GetTrainingEvaluationResponse> {
  const client = getModelClient();
  return modelPromisify(
    client,
    client.getTrainingEvaluation.bind(client),
    request
  );
}

export async function getTrainingJobProgress(request: GetTrainingJobProgressRequest): Promise<GetTrainingJobProgressResponse> {
  const client = getModelClient();
  return modelPromisify(
    client,
    client.getTrainingJobProgress.bind(client),
    request
  );
}

/**
 * 流式获取训练进度 - 返回可迭代的 stream
 */
export function streamTrainingProgress(request: StreamTrainingProgressRequest) {
  const client = getModelClient();
  return client.streamTrainingProgress(request);
}

// 检查 Analytics 服务连接状态
export async function checkAnalyticsConnection(): Promise<boolean> {
  try {
    await getQualityConfig();
    return true;
  } catch {
    resetAllAnalyticsClients();
    return false;
  }
}

// ============================================================
// Data Service API
// ============================================================

function getDataClient(): DataServiceClient {
  if (!dataClient) {
    dataClient = new DataServiceClient(
      `${ANALYTICS_GRPC_HOST}:${ANALYTICS_GRPC_PORT}`,
      grpc.credentials.createInsecure(),
      CHANNEL_OPTIONS
    );
  }
  return dataClient;
}

function dataPromisify<TReq, TRes>(
  client: DataServiceClient,
  method: (input: TReq, callback: (err: grpc.ServiceError | null, value?: TRes) => void) => grpc.ClientUnaryCall,
  request: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    method.call(client, request, (error: grpc.ServiceError | null, response?: TRes) => {
      if (error) {
        reject(error);
      } else {
        resolve(response!);
      }
    });
  });
}

export async function listExperiments(request: ListExperimentsRequest): Promise<ListExperimentsResponse> {
  const client = getDataClient();
  return dataPromisify(
    client,
    client.listExperiments.bind(client),
    request
  );
}

export async function querySensorData(request: QuerySensorDataRequest): Promise<QuerySensorDataResponse> {
  const client = getDataClient();
  return dataPromisify(
    client,
    client.querySensorData.bind(client),
    request
  );
}

export async function getAggregatedStats(request: AggregatedStatsRequest): Promise<AggregatedStatsResponse> {
  const client = getDataClient();
  return dataPromisify(
    client,
    client.getAggregatedStats.bind(client),
    request
  );
}

export async function getExperimentDetail(request: GetExperimentDetailRequest): Promise<ExperimentDetail> {
  const client = getDataClient();
  return dataPromisify(
    client,
    client.getExperimentDetail.bind(client),
    request
  );
}

// ============================================================
// Sample Service API
// ============================================================

function getSampleClient(): SampleServiceClient {
  if (!sampleClient) {
    sampleClient = new SampleServiceClient(
      `${ANALYTICS_GRPC_HOST}:${ANALYTICS_GRPC_PORT}`,
      grpc.credentials.createInsecure(),
      CHANNEL_OPTIONS
    );
  }
  return sampleClient;
}

function samplePromisify<TReq, TRes>(
  client: SampleServiceClient,
  method: (input: TReq, callback: (err: grpc.ServiceError | null, value?: TRes) => void) => grpc.ClientUnaryCall,
  request: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    method.call(client, request, (error: grpc.ServiceError | null, response?: TRes) => {
      if (error) {
        reject(error);
      } else {
        resolve(response!);
      }
    });
  });
}

export async function listSamples(request: ListSamplesRequest): Promise<ListSamplesResponse> {
  const client = getSampleClient();
  return samplePromisify(
    client,
    client.listSamples.bind(client),
    request
  );
}

export async function getSample(request: GetSampleRequest): Promise<Sample> {
  const client = getSampleClient();
  return samplePromisify(
    client,
    client.getSample.bind(client),
    request
  );
}

export async function getSampleGroups(request: GetSampleGroupsRequest): Promise<GetSampleGroupsResponse> {
  const client = getSampleClient();
  return samplePromisify(
    client,
    client.getSampleGroups.bind(client),
    request
  );
}

// ============================================================
// Sample-based Normalized Frames API (新 sample_id 接口)
// ============================================================

export async function getSampleFramesStatus(request: SampleFramesStatusRequest): Promise<SampleFramesStatusResponse> {
  const client = getAnalyticsClient();
  return analyticsPromisify(
    client,
    client.getSampleFramesStatus.bind(client),
    request
  );
}

export async function getBatchSampleFramesStatus(request: BatchSampleFramesStatusRequest): Promise<BatchSampleFramesStatusResponse> {
  const client = getAnalyticsClient();
  return analyticsPromisify(
    client,
    client.getBatchSampleFramesStatus.bind(client),
    request
  );
}

export async function generateSampleFrames(request: GenerateSampleFramesRequest): Promise<GenerateSampleFramesResponse> {
  const client = getAnalyticsClient();
  return analyticsPromisify(
    client,
    client.generateSampleFrames.bind(client),
    request
  );
}

export async function generateBatchSampleFrames(request: BatchGenerateSampleFramesRequest): Promise<BatchGenerateSampleFramesResponse> {
  const client = getAnalyticsClient();
  return analyticsPromisify(
    client,
    client.generateBatchSampleFrames.bind(client),
    request
  );
}

export async function getSampleFrames(request: GetSampleFramesRequest): Promise<GetSampleFramesResponse> {
  const client = getAnalyticsClient();
  return analyticsPromisify(
    client,
    client.getSampleFrames.bind(client),
    request
  );
}

// ============================================================
// Phase API
// ============================================================

export async function getAvailablePhases(request: GetAvailablePhasesRequest): Promise<GetAvailablePhasesResponse> {
  const client = getSampleClient();
  return samplePromisify(
    client,
    client.getAvailablePhases.bind(client),
    request
  );
}

export async function getPhaseTransitions(request: GetPhaseTransitionsRequest): Promise<GetPhaseTransitionsResponse> {
  const client = getSampleClient();
  return samplePromisify(
    client,
    client.getPhaseTransitions.bind(client),
    request
  );
}

// ============================================================
// ML Label Service API
// ============================================================

function getMLLabelClient(): MLLabelServiceClient {
  if (!mlLabelClientCached) {
    mlLabelClientCached = new MLLabelServiceClient(
      `${ANALYTICS_GRPC_HOST}:${ANALYTICS_GRPC_PORT}`,
      grpc.credentials.createInsecure(),
      CHANNEL_OPTIONS
    );
  }
  return mlLabelClientCached;
}

function mlLabelPromisify<TReq, TRes>(
  client: MLLabelServiceClient,
  method: (input: TReq, callback: (err: grpc.ServiceError | null, value?: TRes) => void) => grpc.ClientUnaryCall,
  request: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    method.call(client, request, (error: grpc.ServiceError | null, response?: TRes) => {
      if (error) {
        reject(error);
      } else {
        resolve(response!);
      }
    });
  });
}

export async function listMLLabelConfigs(request: ListMLLabelConfigsRequest): Promise<ListMLLabelConfigsResponse> {
  const client = getMLLabelClient();
  return mlLabelPromisify(client, client.listMLLabelConfigs.bind(client), request);
}

export async function getMLLabelConfig(request: GetMLLabelConfigRequest): Promise<MLLabelConfig> {
  const client = getMLLabelClient();
  return mlLabelPromisify(client, client.getMLLabelConfig.bind(client), request);
}

export async function generateLabels(request: GenerateLabelsRequest): Promise<GenerateLabelsResponse> {
  const client = getMLLabelClient();
  return mlLabelPromisify(client, client.generateLabels.bind(client), request);
}

export async function getLabelDistribution(request: GetLabelDistributionRequest): Promise<GetLabelDistributionResponse> {
  const client = getMLLabelClient();
  return mlLabelPromisify(client, client.getLabelDistribution.bind(client), request);
}

export async function getSampleMLLabels(request: GetSampleMLLabelsRequest): Promise<GetSampleMLLabelsResponse> {
  const client = getMLLabelClient();
  return mlLabelPromisify(client, client.getSampleMLLabels.bind(client), request);
}

export async function previewDataset(request: PreviewDatasetRequest): Promise<PreviewDatasetResponse> {
  const client = getMLLabelClient();
  return mlLabelPromisify(client, client.previewDataset.bind(client), request);
}

// ============================================================
// Export Service API (server streaming)
// ============================================================

function getExportClient(): ExportServiceClient {
  if (!exportClientCached) {
    exportClientCached = new ExportServiceClient(
      `${ANALYTICS_GRPC_HOST}:${ANALYTICS_GRPC_PORT}`,
      grpc.credentials.createInsecure(),
      CHANNEL_OPTIONS
    );
  }
  return exportClientCached;
}

/**
 * 导出数据 - 收集 server streaming 的所有 chunks 为一个 Buffer
 */
export async function exportData(request: ExportDataRequest): Promise<Buffer> {
  const client = getExportClient();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = client.exportData(request);

    stream.on("data", (chunk: ExportDataChunk) => {
      if (chunk.data && chunk.data.length > 0) {
        chunks.push(Buffer.from(chunk.data));
      }
    });

    stream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    stream.on("error", (err: grpc.ServiceError) => {
      reject(err);
    });
  });
}
