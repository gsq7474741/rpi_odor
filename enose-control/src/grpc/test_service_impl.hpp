#pragma once

#include <memory>
#include <grpcpp/grpcpp.h>
#include "enose_service.grpc.pb.h"
#include "../workflows/test_controller.hpp"
#include "../workflows/system_state.hpp"
#include "../hal/load_cell_driver.hpp"

namespace grpc_service {

class TestServiceImpl final : public ::enose::service::TestService::Service {
public:
    TestServiceImpl(
        std::shared_ptr<workflows::SystemState> system_state,
        std::shared_ptr<hal::LoadCellDriver> load_cell);
    
    ~TestServiceImpl() override = default;

    ::grpc::Status StartTest(
        ::grpc::ServerContext* context,
        const ::enose::service::StartTestRequest* request,
        ::enose::service::TestStatusResponse* response) override;

    ::grpc::Status StopTest(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::TestStatusResponse* response) override;

    ::grpc::Status GetTestStatus(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::TestStatusResponse* response) override;

    ::grpc::Status GetTestResults(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::enose::service::TestResultsResponse* response) override;

    ::grpc::Status ClearTestResults(
        ::grpc::ServerContext* context,
        const ::google::protobuf::Empty* request,
        ::google::protobuf::Empty* response) override;

private:
    void fill_status_response(::enose::service::TestStatusResponse* response);
    ::enose::service::TestState convert_state(workflows::TestState state);

    std::shared_ptr<workflows::SystemState> system_state_;
    std::shared_ptr<hal::LoadCellDriver> load_cell_;
    std::unique_ptr<workflows::TestController> test_controller_;
};

} // namespace grpc_service
