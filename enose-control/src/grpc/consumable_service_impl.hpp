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

    // 清洗泵配置
    ::grpc::Status GetWashPumpAssignments(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        consumable::WashPumpAssignmentsResponse* response) override;

    ::grpc::Status SetWashPumpAssignment(
        ::grpc::ServerContext* context,
        const consumable::SetWashPumpAssignmentRequest* request,
        consumable::WashPumpAssignment* response) override;

    ::grpc::Status SetWashPumpVolume(
        ::grpc::ServerContext* context,
        const consumable::SetWashPumpVolumeRequest* request,
        consumable::WashPumpAssignment* response) override;

    ::grpc::Status AddWashPumpConsumption(
        ::grpc::ServerContext* context,
        const consumable::AddWashPumpConsumptionRequest* request,
        consumable::WashPumpAssignment* response) override;

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

    // 标签管理
    ::grpc::Status ListTags(
        ::grpc::ServerContext* context,
        const consumable::ListTagsRequest* request,
        consumable::TagListResponse* response) override;

    ::grpc::Status CreateTag(
        ::grpc::ServerContext* context,
        const consumable::CreateTagRequest* request,
        consumable::Tag* response) override;

    ::grpc::Status DeleteTag(
        ::grpc::ServerContext* context,
        const consumable::DeleteTagRequest* request,
        ::google::protobuf::Empty* response) override;

    ::grpc::Status GetTagSuggestions(
        ::grpc::ServerContext* context,
        const consumable::GetTagSuggestionsRequest* request,
        consumable::TagSuggestionsResponse* response) override;

    // 液体标签关系
    ::grpc::Status SetLiquidTags(
        ::grpc::ServerContext* context,
        const consumable::SetLiquidTagsRequest* request,
        consumable::LiquidTagsResponse* response) override;

    ::grpc::Status GetLiquidTags(
        ::grpc::ServerContext* context,
        const consumable::GetLiquidTagsRequest* request,
        consumable::LiquidTagsResponse* response) override;

    ::grpc::Status ListLiquidsByTags(
        ::grpc::ServerContext* context,
        const consumable::ListLiquidsByTagsRequest* request,
        consumable::LiquidListResponse* response) override;

    // 附件管理
    ::grpc::Status GetLiquidAttachments(
        ::grpc::ServerContext* context,
        const consumable::GetLiquidAttachmentsRequest* request,
        consumable::LiquidAttachmentsResponse* response) override;

    ::grpc::Status CreateLiquidAttachment(
        ::grpc::ServerContext* context,
        const consumable::CreateLiquidAttachmentRequest* request,
        consumable::LiquidAttachment* response) override;

    ::grpc::Status DeleteLiquidAttachment(
        ::grpc::ServerContext* context,
        const consumable::DeleteLiquidAttachmentRequest* request,
        google::protobuf::Empty* response) override;

private:
    db::ConsumableRepository repo_;
    
    // 辅助方法
    void fill_liquid(consumable::Liquid* proto, const db::LiquidRecord& record);
    void fill_consumable(consumable::Consumable* proto, const db::ConsumableRecord& record);
    void fill_metadata_field(consumable::MetadataField* proto, const db::MetadataFieldRecord& record);
    void fill_tag(consumable::Tag* proto, const db::TagRecord& record);
    consumable::LiquidType string_to_liquid_type(const std::string& type);
    std::string liquid_type_to_string(consumable::LiquidType type);
    consumable::FieldType string_to_field_type(const std::string& type);
    std::string field_type_to_string(consumable::FieldType type);
};

} // namespace grpc_service
