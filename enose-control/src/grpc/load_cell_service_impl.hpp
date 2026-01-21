#pragma once

#include <grpcpp/grpcpp.h>
#include <memory>
#include "enose_service.grpc.pb.h"

namespace hal {
class LoadCellDriver;
}

namespace enose_grpc {

/**
 * @brief gRPC LoadCellService 实现
 * 
 * 提供称重传感器控制接口，包括：
 * - 标定向导 (零点、参考重量、保存)
 * - 业务配置 (空瓶基准、溢出阈值)
 * - 实时读数和去皮
 */
class LoadCellServiceImpl final : public enose::service::LoadCellService::Service {
public:
    explicit LoadCellServiceImpl(std::shared_ptr<hal::LoadCellDriver> load_cell);

    // === 标定相关 ===
    ::grpc::Status StartCalibration(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::CalibrationStatus* response
    ) override;

    ::grpc::Status SetZeroPoint(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::CalibrationStatus* response
    ) override;

    ::grpc::Status SetReferenceWeight(
        ::grpc::ServerContext* context,
        const ::enose::service::ReferenceWeightRequest* request,
        ::enose::service::CalibrationStatus* response
    ) override;

    ::grpc::Status SaveCalibration(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::CalibrationResult* response
    ) override;

    ::grpc::Status CancelCalibration(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::google::protobuf::Empty* response
    ) override;

    // === 业务配置 ===
    ::grpc::Status SetEmptyBottleBaseline(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::LoadCellReading* response
    ) override;

    ::grpc::Status SetOverflowThreshold(
        ::grpc::ServerContext* context,
        const ::enose::service::ThresholdRequest* request,
        ::google::protobuf::Empty* response
    ) override;

    ::grpc::Status GetLoadCellConfig(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::LoadCellConfig* response
    ) override;

    ::grpc::Status SaveLoadCellConfig(
        ::grpc::ServerContext* context,
        const ::enose::service::LoadCellConfig* request,
        ::google::protobuf::Empty* response
    ) override;

    // === 运行时操作 ===
    ::grpc::Status Tare(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::LoadCellReading* response
    ) override;

    ::grpc::Status GetReading(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::LoadCellReading* response
    ) override;

    ::grpc::Status StreamReadings(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::grpc::ServerWriter<::enose::service::LoadCellReading>* writer
    ) override;

private:
    std::shared_ptr<hal::LoadCellDriver> load_cell_;
    
    // 填充 LoadCellReading proto
    void fill_reading(::enose::service::LoadCellReading* reading);
    
    // 填充 CalibrationStatus proto
    void fill_calibration_status(::enose::service::CalibrationStatus* status);
};

} // namespace enose_grpc
