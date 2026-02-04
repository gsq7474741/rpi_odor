import * as grpc from "@grpc/grpc-js";
import { AnalyticsServiceClient, LabelServiceClient, ModelServiceClient, DataServiceClient, SampleServiceClient } from "../generated/enose_analytics.grpc-client";
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
} from "../generated/enose_analytics";

// Analytics gRPC 服务器地址 (从环境变量读取，默认与控制服务同机)
const ANALYTICS_GRPC_HOST = process.env.ANALYTICS_GRPC_HOST || process.env.GRPC_HOST || "rpi5.local";
const ANALYTICS_GRPC_PORT = process.env.ANALYTICS_GRPC_PORT || "50052";

// 创建客户端实例
let analyticsClient: AnalyticsServiceClient | null = null;
let labelClient: LabelServiceClient | null = null;
let modelClient: ModelServiceClient | null = null;
let dataClient: DataServiceClient | null = null;
let sampleClient: SampleServiceClient | null = null;

function getAnalyticsClient(): AnalyticsServiceClient {
  if (!analyticsClient) {
    analyticsClient = new AnalyticsServiceClient(
      `${ANALYTICS_GRPC_HOST}:${ANALYTICS_GRPC_PORT}`,
      grpc.credentials.createInsecure()
    );
  }
  return analyticsClient;
}

function getLabelClient(): LabelServiceClient {
  if (!labelClient) {
    labelClient = new LabelServiceClient(
      `${ANALYTICS_GRPC_HOST}:${ANALYTICS_GRPC_PORT}`,
      grpc.credentials.createInsecure()
    );
  }
  return labelClient;
}

function getModelClient(): ModelServiceClient {
  if (!modelClient) {
    modelClient = new ModelServiceClient(
      `${ANALYTICS_GRPC_HOST}:${ANALYTICS_GRPC_PORT}`,
      grpc.credentials.createInsecure()
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

// 检查 Analytics 服务连接状态
export async function checkAnalyticsConnection(): Promise<boolean> {
  try {
    await getQualityConfig();
    return true;
  } catch {
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
      grpc.credentials.createInsecure()
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
      grpc.credentials.createInsecure()
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
