#include "grpc/load_cell_service_impl.hpp"
#include "hal/load_cell_driver.hpp"
#include <spdlog/spdlog.h>
#include <thread>
#include <chrono>

namespace enose_grpc {

LoadCellServiceImpl::LoadCellServiceImpl(std::shared_ptr<hal::LoadCellDriver> load_cell)
    : load_cell_(std::move(load_cell))
{
    spdlog::info("LoadCellServiceImpl: Initialized");
}

void LoadCellServiceImpl::fill_reading(::enose::service::LoadCellReading* reading) {
    auto status = load_cell_->get_status();
    
    reading->set_weight_grams(status.filtered_weight);
    reading->set_raw_percent(status.raw_percent);
    reading->set_is_calibrated(status.is_calibrated);
    reading->set_is_stable(status.is_stable);
    
    switch (status.trend) {
        case hal::WeightTrend::STABLE:
            reading->set_trend(::enose::service::LoadCellReading::STABLE);
            break;
        case hal::WeightTrend::INCREASING:
            reading->set_trend(::enose::service::LoadCellReading::INCREASING);
            break;
        case hal::WeightTrend::DECREASING:
            reading->set_trend(::enose::service::LoadCellReading::DECREASING);
            break;
    }
}

void LoadCellServiceImpl::fill_calibration_status(::enose::service::CalibrationStatus* status) {
    auto step = load_cell_->get_calibration_step();
    auto reading = load_cell_->get_status();
    
    switch (step) {
        case hal::CalibrationStep::IDLE:
            status->set_step(::enose::service::CalibrationStatus::IDLE);
            break;
        case hal::CalibrationStep::ZERO_POINT:
            status->set_step(::enose::service::CalibrationStatus::ZERO_POINT);
            break;
        case hal::CalibrationStep::REFERENCE_WEIGHT:
            status->set_step(::enose::service::CalibrationStatus::REFERENCE_WEIGHT);
            break;
        case hal::CalibrationStep::VERIFY:
            status->set_step(::enose::service::CalibrationStatus::VERIFY);
            break;
        case hal::CalibrationStep::COMPLETE:
            status->set_step(::enose::service::CalibrationStatus::COMPLETE);
            break;
    }
    
    status->set_current_reading(reading.is_calibrated ? reading.filtered_weight : reading.raw_percent);
    status->set_success(true);
}

// === 标定相关 ===

::grpc::Status LoadCellServiceImpl::StartCalibration(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::CalibrationStatus* response
) {
    spdlog::info("LoadCellServiceImpl: StartCalibration");
    load_cell_->start_calibration();
    fill_calibration_status(response);
    response->set_message("请移除悬臂上的所有物体，然后点击「设置零点」");
    return ::grpc::Status::OK;
}

::grpc::Status LoadCellServiceImpl::SetZeroPoint(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::CalibrationStatus* response
) {
    spdlog::info("LoadCellServiceImpl: SetZeroPoint");
    load_cell_->set_zero_point();
    fill_calibration_status(response);
    response->set_message("零点已设置。请放置已知重量的物体，输入重量后点击「确认标定」");
    return ::grpc::Status::OK;
}

::grpc::Status LoadCellServiceImpl::SetReferenceWeight(
    ::grpc::ServerContext* context,
    const ::enose::service::ReferenceWeightRequest* request,
    ::enose::service::CalibrationStatus* response
) {
    float grams = request->weight_grams();
    spdlog::info("LoadCellServiceImpl: SetReferenceWeight = {:.1f}g", grams);
    
    if (grams <= 0) {
        response->set_success(false);
        response->set_message("参考重量必须大于 0");
        return ::grpc::Status::OK;
    }
    
    load_cell_->set_reference_weight(grams);
    fill_calibration_status(response);
    response->set_message("标定完成，请验证读数。点击「保存」确认或「重新标定」");
    return ::grpc::Status::OK;
}

::grpc::Status LoadCellServiceImpl::SaveCalibration(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::CalibrationResult* response
) {
    spdlog::info("LoadCellServiceImpl: SaveCalibration");
    load_cell_->save_calibration();
    
    response->set_success(true);
    response->set_message("标定已保存到 printer.cfg");
    return ::grpc::Status::OK;
}

::grpc::Status LoadCellServiceImpl::CancelCalibration(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::google::protobuf::Empty* response
) {
    spdlog::info("LoadCellServiceImpl: CancelCalibration");
    load_cell_->cancel_calibration();
    return ::grpc::Status::OK;
}

// === 业务配置 ===

::grpc::Status LoadCellServiceImpl::WaitForEmptyBottle(
    ::grpc::ServerContext* context,
    const ::enose::service::WaitForEmptyBottleRequest* request,
    ::enose::service::WaitForEmptyBottleResponse* response
) {
    float tolerance = request->tolerance() > 0 ? request->tolerance() : 30.0f;
    float timeout_sec = request->timeout_sec() > 0 ? request->timeout_sec() : 60.0f;
    float stability_window_sec = request->stability_window_sec() > 0 ? request->stability_window_sec() : 5.0f;
    
    spdlog::info("LoadCellServiceImpl: WaitForEmptyBottle (tol={:.1f}g, timeout={:.1f}s, window={:.1f}s)",
                 tolerance, timeout_sec, stability_window_sec);
    
    auto result = load_cell_->wait_for_empty_bottle(tolerance, timeout_sec, stability_window_sec);
    
    response->set_success(result.success);
    response->set_empty_weight(result.empty_weight);
    response->set_error_message(result.error_message);
    
    return ::grpc::Status::OK;
}

::grpc::Status LoadCellServiceImpl::ResetDynamicEmptyWeight(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::google::protobuf::Empty* response
) {
    spdlog::info("LoadCellServiceImpl: ResetDynamicEmptyWeight");
    load_cell_->reset_dynamic_empty_weight();
    return ::grpc::Status::OK;
}

::grpc::Status LoadCellServiceImpl::GetDynamicEmptyWeight(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::DynamicEmptyWeightResponse* response
) {
    auto weight = load_cell_->get_dynamic_empty_weight();
    response->set_has_value(weight.has_value());
    response->set_empty_weight(weight.value_or(0.0f));
    return ::grpc::Status::OK;
}

::grpc::Status LoadCellServiceImpl::SetOverflowThreshold(
    ::grpc::ServerContext* context,
    const ::enose::service::ThresholdRequest* request,
    ::google::protobuf::Empty* response
) {
    float threshold = request->value();
    spdlog::info("LoadCellServiceImpl: SetOverflowThreshold = {:.1f}g", threshold);
    load_cell_->set_overflow_threshold(threshold);
    return ::grpc::Status::OK;
}

::grpc::Status LoadCellServiceImpl::SetPumpCalibration(
    ::grpc::ServerContext* context,
    const ::enose::service::PumpCalibrationRequest* request,
    ::google::protobuf::Empty* response
) {
    float slope = request->slope();
    float offset = request->offset();
    spdlog::info("LoadCellServiceImpl: SetPumpCalibration slope={:.4f} g/mm, offset={:.2f} g", slope, offset);
    load_cell_->set_pump_calibration(slope, offset);
    return ::grpc::Status::OK;
}

::grpc::Status LoadCellServiceImpl::GetLoadCellConfig(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::LoadCellConfig* response
) {
    auto config = load_cell_->get_config();
    
    response->set_overflow_threshold(config.overflow_threshold);
    response->set_drain_complete_margin(config.drain_complete_margin);
    response->set_stable_threshold(config.stable_stddev_threshold);
    
    // 泵校准系数
    response->set_pump_mm_to_ml(config.pump_mm_to_ml);
    response->set_pump_mm_offset(config.pump_mm_offset);
    
    // 重量校准系数
    response->set_weight_scale(config.weight_scale);
    response->set_weight_offset(config.weight_offset);
    
    return ::grpc::Status::OK;
}

::grpc::Status LoadCellServiceImpl::SaveLoadCellConfig(
    ::grpc::ServerContext* context,
    const ::enose::service::LoadCellConfig* request,
    ::google::protobuf::Empty* response
) {
    hal::LoadCellConfig config = load_cell_->get_config();
    
    config.overflow_threshold = request->overflow_threshold();
    config.drain_complete_margin = request->drain_complete_margin();
    config.stable_stddev_threshold = request->stable_threshold();
    
    // 泵校准系数 (mm -> 测量重量)
    if (request->pump_mm_to_ml() != 0) {
        config.pump_mm_to_ml = request->pump_mm_to_ml();
    }
    if (request->pump_mm_offset() != 0) {
        config.pump_mm_offset = request->pump_mm_offset();
    }
    
    // 重量校准系数 (测量值 -> 真实值)
    if (request->weight_scale() != 0) {
        config.weight_scale = request->weight_scale();
    }
    config.weight_offset = request->weight_offset(); // offset可以为0
    
    load_cell_->set_config(config);
    
    // 持久化到文件
    if (load_cell_->save_config()) {
        spdlog::info("LoadCellServiceImpl: Config saved to file (weight_scale={:.4f}, weight_offset={:.4f})",
                     config.weight_scale, config.weight_offset);
    } else {
        spdlog::warn("LoadCellServiceImpl: Config updated but not persisted to file");
    }
    
    return ::grpc::Status::OK;
}

// === 运行时操作 ===

::grpc::Status LoadCellServiceImpl::Tare(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::LoadCellReading* response
) {
    spdlog::info("LoadCellServiceImpl: Tare");
    load_cell_->tare();
    fill_reading(response);
    return ::grpc::Status::OK;
}

::grpc::Status LoadCellServiceImpl::GetReading(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::enose::service::LoadCellReading* response
) {
    fill_reading(response);
    return ::grpc::Status::OK;
}

::grpc::Status LoadCellServiceImpl::StreamReadings(
    ::grpc::ServerContext* context,
    const ::google::protobuf::Empty* request,
    ::grpc::ServerWriter<::enose::service::LoadCellReading>* writer
) {
    spdlog::info("LoadCellServiceImpl: StreamReadings started");
    
    while (!context->IsCancelled()) {
        ::enose::service::LoadCellReading reading;
        fill_reading(&reading);
        
        if (!writer->Write(reading)) {
            break;
        }
        
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    
    spdlog::info("LoadCellServiceImpl: StreamReadings ended");
    return ::grpc::Status::OK;
}

} // namespace enose_grpc
