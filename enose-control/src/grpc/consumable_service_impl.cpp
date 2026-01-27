#include "consumable_service_impl.hpp"
#include <spdlog/spdlog.h>
#include <google/protobuf/util/time_util.h>

namespace grpc_service {

ConsumableServiceImpl::ConsumableServiceImpl() {
    spdlog::info("ConsumableService 初始化完成");
}

// ============================================================
// 辅助方法
// ============================================================

void ConsumableServiceImpl::fill_liquid(consumable::Liquid* proto, const db::LiquidRecord& record) {
    proto->set_id(record.id);
    proto->set_name(record.name);
    proto->set_type(string_to_liquid_type(record.type));
    proto->set_description(record.description);
    proto->set_density(record.density);
    proto->set_metadata_json(record.metadata_json);
    proto->set_is_active(record.is_active);
    *proto->mutable_created_at() = google::protobuf::util::TimeUtil::TimeTToTimestamp(
        std::chrono::system_clock::to_time_t(record.created_at));
    *proto->mutable_updated_at() = google::protobuf::util::TimeUtil::TimeTToTimestamp(
        std::chrono::system_clock::to_time_t(record.updated_at));
}

void ConsumableServiceImpl::fill_consumable(consumable::Consumable* proto, const db::ConsumableRecord& record) {
    proto->set_id(record.id);
    proto->set_name(record.name);
    
    if (record.type == "pump_tube") {
        proto->set_type(consumable::CONSUMABLE_TYPE_PUMP_TUBE);
    } else if (record.type == "carbon_filter") {
        proto->set_type(consumable::CONSUMABLE_TYPE_CARBON_FILTER);
    } else if (record.type == "vacuum_filter") {
        proto->set_type(consumable::CONSUMABLE_TYPE_VACUUM_FILTER);
    }
    
    proto->set_accumulated_seconds(record.accumulated_seconds);
    proto->set_lifetime_seconds(record.lifetime_seconds);
    proto->set_warning_threshold(record.warning_threshold);
    proto->set_critical_threshold(record.critical_threshold);
    
    int status = record.status();
    if (status == 2) {
        proto->set_status(consumable::CONSUMABLE_STATUS_CRITICAL);
    } else if (status == 1) {
        proto->set_status(consumable::CONSUMABLE_STATUS_WARNING);
    } else {
        proto->set_status(consumable::CONSUMABLE_STATUS_OK);
    }
    
    proto->set_remaining_ratio(record.remaining_ratio());
    proto->set_remaining_seconds(record.remaining_seconds());
    *proto->mutable_last_reset_at() = google::protobuf::util::TimeUtil::TimeTToTimestamp(
        std::chrono::system_clock::to_time_t(record.last_reset_at));
    *proto->mutable_updated_at() = google::protobuf::util::TimeUtil::TimeTToTimestamp(
        std::chrono::system_clock::to_time_t(record.updated_at));
}

void ConsumableServiceImpl::fill_metadata_field(consumable::MetadataField* proto, const db::MetadataFieldRecord& record) {
    proto->set_id(record.id);
    proto->set_entity_type(record.entity_type);
    proto->set_field_key(record.field_key);
    proto->set_field_name(record.field_name);
    proto->set_field_type(string_to_field_type(record.field_type));
    proto->set_description(record.description);
    proto->set_is_required(record.is_required);
    proto->set_default_value(record.default_value);
    proto->set_options_json(record.options_json);
    proto->set_display_order(record.display_order);
    proto->set_is_active(record.is_active);
}

consumable::LiquidType ConsumableServiceImpl::string_to_liquid_type(const std::string& type) {
    if (type == "sample") return consumable::LIQUID_TYPE_SAMPLE;
    if (type == "rinse") return consumable::LIQUID_TYPE_RINSE;
    if (type == "other") return consumable::LIQUID_TYPE_OTHER;
    return consumable::LIQUID_TYPE_UNSPECIFIED;
}

std::string ConsumableServiceImpl::liquid_type_to_string(consumable::LiquidType type) {
    switch (type) {
        case consumable::LIQUID_TYPE_SAMPLE: return "sample";
        case consumable::LIQUID_TYPE_RINSE: return "rinse";
        case consumable::LIQUID_TYPE_OTHER: return "other";
        default: return "other";
    }
}

consumable::FieldType ConsumableServiceImpl::string_to_field_type(const std::string& type) {
    if (type == "string") return consumable::FIELD_TYPE_STRING;
    if (type == "number") return consumable::FIELD_TYPE_NUMBER;
    if (type == "boolean") return consumable::FIELD_TYPE_BOOLEAN;
    if (type == "select") return consumable::FIELD_TYPE_SELECT;
    if (type == "multi_select") return consumable::FIELD_TYPE_MULTI_SELECT;
    if (type == "tags") return consumable::FIELD_TYPE_TAGS;
    if (type == "rich_text") return consumable::FIELD_TYPE_RICH_TEXT;
    if (type == "image") return consumable::FIELD_TYPE_IMAGE;
    if (type == "image_gallery") return consumable::FIELD_TYPE_IMAGE_GALLERY;
    if (type == "date") return consumable::FIELD_TYPE_DATE;
    return consumable::FIELD_TYPE_UNSPECIFIED;
}

std::string ConsumableServiceImpl::field_type_to_string(consumable::FieldType type) {
    switch (type) {
        case consumable::FIELD_TYPE_STRING: return "string";
        case consumable::FIELD_TYPE_NUMBER: return "number";
        case consumable::FIELD_TYPE_BOOLEAN: return "boolean";
        case consumable::FIELD_TYPE_SELECT: return "select";
        case consumable::FIELD_TYPE_MULTI_SELECT: return "multi_select";
        case consumable::FIELD_TYPE_TAGS: return "tags";
        case consumable::FIELD_TYPE_RICH_TEXT: return "rich_text";
        case consumable::FIELD_TYPE_IMAGE: return "image";
        case consumable::FIELD_TYPE_IMAGE_GALLERY: return "image_gallery";
        case consumable::FIELD_TYPE_DATE: return "date";
        default: return "string";
    }
}

// ============================================================
// 液体管理
// ============================================================

::grpc::Status ConsumableServiceImpl::ListLiquids(
    ::grpc::ServerContext* context,
    const consumable::ListLiquidsRequest* request,
    consumable::LiquidListResponse* response) {
    
    std::string type_filter;
    if (request->type_filter() != consumable::LIQUID_TYPE_UNSPECIFIED) {
        type_filter = liquid_type_to_string(request->type_filter());
    }
    
    auto records = repo_.list_liquids(
        type_filter,
        request->include_inactive(),
        request->limit() > 0 ? request->limit() : 100,
        request->offset());
    
    for (const auto& record : records) {
        fill_liquid(response->add_liquids(), record);
    }
    
    response->set_total_count(repo_.count_liquids(type_filter, request->include_inactive()));
    
    return ::grpc::Status::OK;
}

::grpc::Status ConsumableServiceImpl::GetLiquid(
    ::grpc::ServerContext* context,
    const consumable::GetLiquidRequest* request,
    consumable::Liquid* response) {
    
    auto record = repo_.get_liquid(request->id());
    if (!record) {
        return ::grpc::Status(::grpc::NOT_FOUND, "Liquid not found");
    }
    
    fill_liquid(response, *record);
    return ::grpc::Status::OK;
}

::grpc::Status ConsumableServiceImpl::CreateLiquid(
    ::grpc::ServerContext* context,
    const consumable::CreateLiquidRequest* request,
    consumable::Liquid* response) {
    
    auto id = repo_.create_liquid(
        request->name(),
        liquid_type_to_string(request->type()),
        request->description(),
        request->density() > 0 ? request->density() : 1.0f,
        request->metadata_json().empty() ? "{}" : request->metadata_json());
    
    if (!id) {
        return ::grpc::Status(::grpc::INTERNAL, "Failed to create liquid");
    }
    
    auto record = repo_.get_liquid(*id);
    if (record) {
        fill_liquid(response, *record);
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status ConsumableServiceImpl::UpdateLiquid(
    ::grpc::ServerContext* context,
    const consumable::UpdateLiquidRequest* request,
    consumable::Liquid* response) {
    
    bool success = repo_.update_liquid(
        request->id(),
        request->name(),
        liquid_type_to_string(request->type()),
        request->description(),
        request->density(),
        request->metadata_json(),
        request->is_active());
    
    if (!success) {
        return ::grpc::Status(::grpc::INTERNAL, "Failed to update liquid");
    }
    
    auto record = repo_.get_liquid(request->id());
    if (record) {
        fill_liquid(response, *record);
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status ConsumableServiceImpl::DeleteLiquid(
    ::grpc::ServerContext* context,
    const consumable::DeleteLiquidRequest* request,
    ::google::protobuf::Empty* response) {
    
    bool success = repo_.delete_liquid(request->id());
    if (!success) {
        return ::grpc::Status(::grpc::INTERNAL, "Failed to delete liquid");
    }
    
    return ::grpc::Status::OK;
}

// ============================================================
// 泵配置
// ============================================================

::grpc::Status ConsumableServiceImpl::GetPumpAssignments(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    consumable::PumpAssignmentsResponse* response) {
    
    auto assignments = repo_.get_pump_assignments();
    
    for (const auto& a : assignments) {
        auto* pa = response->add_assignments();
        pa->set_pump_index(a.pump_index);
        if (a.liquid_id) {
            pa->set_liquid_id(*a.liquid_id);
            // 获取液体详情
            auto liquid = repo_.get_liquid(*a.liquid_id);
            if (liquid) {
                fill_liquid(pa->mutable_liquid(), *liquid);
            }
        }
        pa->set_notes(a.notes);
        *pa->mutable_updated_at() = google::protobuf::util::TimeUtil::TimeTToTimestamp(
            std::chrono::system_clock::to_time_t(a.updated_at));
        // 容量相关字段
        pa->set_initial_volume_ml(a.initial_volume_ml);
        pa->set_consumed_volume_ml(a.consumed_volume_ml);
        pa->set_remaining_volume_ml(a.remaining_volume_ml());
        pa->set_low_volume_threshold_ml(a.low_volume_threshold_ml);
        pa->set_is_low_volume(a.is_low_volume());
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status ConsumableServiceImpl::SetPumpAssignment(
    ::grpc::ServerContext* context,
    const consumable::SetPumpAssignmentRequest* request,
    consumable::PumpAssignment* response) {
    
    std::optional<int> liquid_id;
    if (request->has_liquid_id()) {
        liquid_id = request->liquid_id();
    }
    
    std::optional<double> initial_volume_ml;
    std::optional<double> low_volume_threshold_ml;
    if (request->has_initial_volume_ml()) {
        initial_volume_ml = request->initial_volume_ml();
    }
    if (request->has_low_volume_threshold_ml()) {
        low_volume_threshold_ml = request->low_volume_threshold_ml();
    }
    
    bool success = repo_.set_pump_assignment(
        request->pump_index(),
        liquid_id,
        request->notes(),
        initial_volume_ml,
        low_volume_threshold_ml);
    
    if (!success) {
        return ::grpc::Status(::grpc::INTERNAL, "Failed to set pump assignment");
    }
    
    // 返回更新后的配置
    auto record = repo_.get_pump_assignment(request->pump_index());
    if (record) {
        response->set_pump_index(record->pump_index);
        if (record->liquid_id) {
            response->set_liquid_id(*record->liquid_id);
            auto liquid = repo_.get_liquid(*record->liquid_id);
            if (liquid) {
                fill_liquid(response->mutable_liquid(), *liquid);
            }
        }
        response->set_notes(record->notes);
        response->set_initial_volume_ml(record->initial_volume_ml);
        response->set_consumed_volume_ml(record->consumed_volume_ml);
        response->set_remaining_volume_ml(record->remaining_volume_ml());
        response->set_low_volume_threshold_ml(record->low_volume_threshold_ml);
        response->set_is_low_volume(record->is_low_volume());
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status ConsumableServiceImpl::SetPumpVolume(
    ::grpc::ServerContext* context,
    const consumable::SetPumpVolumeRequest* request,
    consumable::PumpAssignment* response) {
    
    std::optional<double> threshold;
    if (request->has_low_volume_threshold_ml()) {
        threshold = request->low_volume_threshold_ml();
    }
    
    bool success = repo_.set_pump_volume(
        request->pump_index(),
        request->initial_volume_ml(),
        threshold,
        request->reset_consumed());
    
    if (!success) {
        return ::grpc::Status(::grpc::INTERNAL, "Failed to set pump volume");
    }
    
    // 返回更新后的配置
    auto record = repo_.get_pump_assignment(request->pump_index());
    if (record) {
        response->set_pump_index(record->pump_index);
        if (record->liquid_id) {
            response->set_liquid_id(*record->liquid_id);
            auto liquid = repo_.get_liquid(*record->liquid_id);
            if (liquid) {
                fill_liquid(response->mutable_liquid(), *liquid);
            }
        }
        response->set_notes(record->notes);
        response->set_initial_volume_ml(record->initial_volume_ml);
        response->set_consumed_volume_ml(record->consumed_volume_ml);
        response->set_remaining_volume_ml(record->remaining_volume_ml());
        response->set_low_volume_threshold_ml(record->low_volume_threshold_ml);
        response->set_is_low_volume(record->is_low_volume());
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status ConsumableServiceImpl::AddPumpConsumption(
    ::grpc::ServerContext* context,
    const consumable::AddPumpConsumptionRequest* request,
    consumable::PumpAssignment* response) {
    
    std::optional<int> experiment_id;
    if (request->has_experiment_id()) {
        experiment_id = request->experiment_id();
    }
    
    bool success = repo_.add_pump_consumption(
        request->pump_index(),
        request->volume_ml(),
        experiment_id);
    
    if (!success) {
        return ::grpc::Status(::grpc::INTERNAL, "Failed to add pump consumption");
    }
    
    // 返回更新后的配置
    auto record = repo_.get_pump_assignment(request->pump_index());
    if (record) {
        response->set_pump_index(record->pump_index);
        if (record->liquid_id) {
            response->set_liquid_id(*record->liquid_id);
            auto liquid = repo_.get_liquid(*record->liquid_id);
            if (liquid) {
                fill_liquid(response->mutable_liquid(), *liquid);
            }
        }
        response->set_notes(record->notes);
        response->set_initial_volume_ml(record->initial_volume_ml);
        response->set_consumed_volume_ml(record->consumed_volume_ml);
        response->set_remaining_volume_ml(record->remaining_volume_ml());
        response->set_low_volume_threshold_ml(record->low_volume_threshold_ml);
        response->set_is_low_volume(record->is_low_volume());
    }
    
    return ::grpc::Status::OK;
}

// ============================================================
// 耗材状态
// ============================================================

::grpc::Status ConsumableServiceImpl::GetConsumableStatus(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    consumable::ConsumableStatusResponse* response) {
    
    auto consumables = repo_.get_all_consumables();
    
    int warning_count = 0;
    int critical_count = 0;
    
    for (const auto& c : consumables) {
        fill_consumable(response->add_consumables(), c);
        
        int status = c.status();
        if (status == 2) critical_count++;
        else if (status == 1) warning_count++;
    }
    
    response->set_warning_count(warning_count);
    response->set_critical_count(critical_count);
    
    return ::grpc::Status::OK;
}

::grpc::Status ConsumableServiceImpl::ResetConsumable(
    ::grpc::ServerContext* context,
    const consumable::ResetConsumableRequest* request,
    consumable::Consumable* response) {
    
    bool success = repo_.reset_consumable(request->consumable_id(), request->notes());
    if (!success) {
        return ::grpc::Status(::grpc::INTERNAL, "Failed to reset consumable");
    }
    
    auto record = repo_.get_consumable(request->consumable_id());
    if (record) {
        fill_consumable(response, *record);
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status ConsumableServiceImpl::UpdateConsumableLifetime(
    ::grpc::ServerContext* context,
    const consumable::UpdateLifetimeRequest* request,
    consumable::Consumable* response) {
    
    bool success = repo_.update_lifetime(request->consumable_id(), request->lifetime_seconds());
    if (!success) {
        return ::grpc::Status(::grpc::INTERNAL, "Failed to update consumable lifetime");
    }
    
    auto record = repo_.get_consumable(request->consumable_id());
    if (record) {
        fill_consumable(response, *record);
    }
    
    return ::grpc::Status::OK;
}

// ============================================================
// 元数据字段管理
// ============================================================

::grpc::Status ConsumableServiceImpl::ListMetadataFields(
    ::grpc::ServerContext* context,
    const consumable::ListMetadataFieldsRequest* request,
    consumable::MetadataFieldListResponse* response) {
    
    auto fields = repo_.list_metadata_fields(
        request->entity_type(),
        request->include_inactive());
    
    for (const auto& f : fields) {
        fill_metadata_field(response->add_fields(), f);
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status ConsumableServiceImpl::CreateMetadataField(
    ::grpc::ServerContext* context,
    const consumable::CreateMetadataFieldRequest* request,
    consumable::MetadataField* response) {
    
    auto id = repo_.create_metadata_field(
        request->entity_type(),
        request->field_key(),
        request->field_name(),
        field_type_to_string(request->field_type()),
        request->description(),
        request->is_required(),
        request->default_value(),
        request->options_json(),
        request->display_order());
    
    if (!id) {
        return ::grpc::Status(::grpc::INTERNAL, "Failed to create metadata field");
    }
    
    // 读取并返回创建的字段
    auto fields = repo_.list_metadata_fields(request->entity_type(), true);
    for (const auto& f : fields) {
        if (f.id == *id) {
            fill_metadata_field(response, f);
            break;
        }
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status ConsumableServiceImpl::UpdateMetadataField(
    ::grpc::ServerContext* context,
    const consumable::UpdateMetadataFieldRequest* request,
    consumable::MetadataField* response) {
    
    bool success = repo_.update_metadata_field(
        request->id(),
        request->field_name(),
        request->description(),
        request->is_required(),
        request->default_value(),
        request->options_json(),
        request->display_order(),
        request->is_active());
    
    if (!success) {
        return ::grpc::Status(::grpc::INTERNAL, "Failed to update metadata field");
    }
    
    return ::grpc::Status::OK;
}

::grpc::Status ConsumableServiceImpl::DeleteMetadataField(
    ::grpc::ServerContext* context,
    const consumable::DeleteMetadataFieldRequest* request,
    ::google::protobuf::Empty* response) {
    
    bool success = repo_.delete_metadata_field(request->id());
    if (!success) {
        return ::grpc::Status(::grpc::INTERNAL, "Failed to delete metadata field");
    }
    
    return ::grpc::Status::OK;
}

} // namespace grpc_service
