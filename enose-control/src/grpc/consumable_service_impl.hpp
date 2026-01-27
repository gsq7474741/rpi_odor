#pragma once

#include <grpcpp/grpcpp.h>
#include "enose_consumable.grpc.pb.h"
#include "../db/consumable_repository.hpp"
#include <memory>

namespace grpc_service {

namespace consumable = ::enose::consumable;

class ConsumableServiceImpl final : public consumable::ConsumableService::Service {
public:
    ConsumableServiceImpl();
    ~ConsumableServiceImpl() = default;

    // 液体管理
    ::grpc::Status ListLiquids(
        ::grpc::ServerContext* context,
        const consumable::ListLiquidsRequest* request,
        consumable::LiquidListResponse* response) override;

    ::grpc::Status GetLiquid(
        ::grpc::ServerContext* context,
        const consumable::GetLiquidRequest* request,
        consumable::Liquid* response) override;

    ::grpc::Status CreateLiquid(
        ::grpc::ServerContext* context,
        const consumable::CreateLiquidRequest* request,
        consumable::Liquid* response) override;

    ::grpc::Status UpdateLiquid(
        ::grpc::ServerContext* context,
        const consumable::UpdateLiquidRequest* request,
        consumable::Liquid* response) override;

    ::grpc::Status DeleteLiquid(
        ::grpc::ServerContext* context,
        const consumable::DeleteLiquidRequest* request,
        ::google::protobuf::Empty* response) override;

    // 泵配置
    ::grpc::Status GetPumpAssignments(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        consumable::PumpAssignmentsResponse* response) override;

    ::grpc::Status SetPumpAssignment(
        ::grpc::ServerContext* context,
        const consumable::SetPumpAssignmentRequest* request,
        consumable::PumpAssignment* response) override;

    ::grpc::Status SetPumpVolume(
        ::grpc::ServerContext* context,
        const consumable::SetPumpVolumeRequest* request,
        consumable::PumpAssignment* response) override;

    ::grpc::Status AddPumpConsumption(
        ::grpc::ServerContext* context,
        const consumable::AddPumpConsumptionRequest* request,
        consumable::PumpAssignment* response) override;

    // 耗材状态
    ::grpc::Status GetConsumableStatus(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        consumable::ConsumableStatusResponse* response) override;

    ::grpc::Status ResetConsumable(
        ::grpc::ServerContext* context,
        const consumable::ResetConsumableRequest* request,
        consumable::Consumable* response) override;

    ::grpc::Status UpdateConsumableLifetime(
        ::grpc::ServerContext* context,
        const consumable::UpdateLifetimeRequest* request,
        consumable::Consumable* response) override;

    // 元数据字段管理
    ::grpc::Status ListMetadataFields(
        ::grpc::ServerContext* context,
        const consumable::ListMetadataFieldsRequest* request,
        consumable::MetadataFieldListResponse* response) override;

    ::grpc::Status CreateMetadataField(
        ::grpc::ServerContext* context,
        const consumable::CreateMetadataFieldRequest* request,
        consumable::MetadataField* response) override;

    ::grpc::Status UpdateMetadataField(
        ::grpc::ServerContext* context,
        const consumable::UpdateMetadataFieldRequest* request,
        consumable::MetadataField* response) override;

    ::grpc::Status DeleteMetadataField(
        ::grpc::ServerContext* context,
        const consumable::DeleteMetadataFieldRequest* request,
        ::google::protobuf::Empty* response) override;

private:
    db::ConsumableRepository repo_;
    
    // 辅助方法
    void fill_liquid(consumable::Liquid* proto, const db::LiquidRecord& record);
    void fill_consumable(consumable::Consumable* proto, const db::ConsumableRecord& record);
    void fill_metadata_field(consumable::MetadataField* proto, const db::MetadataFieldRecord& record);
    consumable::LiquidType string_to_liquid_type(const std::string& type);
    std::string liquid_type_to_string(consumable::LiquidType type);
    consumable::FieldType string_to_field_type(const std::string& type);
    std::string field_type_to_string(consumable::FieldType type);
};

} // namespace grpc_service
