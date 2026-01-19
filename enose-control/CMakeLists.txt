cmake_minimum_required(VERSION 3.25)
project(enose-control CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# output to bin directory
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

# Conan dependencies (Removed in favor of system libs)
# find_package(Boost REQUIRED COMPONENTS system thread date_time serial_port)
# find_package(fmt REQUIRED)
# find_package(spdlog REQUIRED)
# find_package(nlohmann_json REQUIRED)
# find_package(gRPC REQUIRED)
# find_package(Protobuf REQUIRED)
# find_package(yaml-cpp REQUIRED)

# System dependencies
find_package(Boost REQUIRED COMPONENTS system thread date_time)
find_package(fmt REQUIRED)
find_package(spdlog REQUIRED)
find_package(nlohmann_json REQUIRED)
find_package(gRPC REQUIRED)
find_package(Protobuf REQUIRED)
find_package(yaml-cpp REQUIRED)

# Protobuf & gRPC Generation
find_program(PROTOC_EXECUTABLE protoc)
find_program(GRPC_CPP_PLUGIN grpc_cpp_plugin)

set(PROTO_SRC_DIR "${CMAKE_SOURCE_DIR}/../proto")
set(PROTO_GEN_DIR "${CMAKE_BINARY_DIR}/gen")
file(MAKE_DIRECTORY ${PROTO_GEN_DIR})

file(GLOB PROTO_FILES "${PROTO_SRC_DIR}/*.proto")

set(PROTO_SRCS "")
set(PROTO_HDRS "")

foreach(PROTO_FILE ${PROTO_FILES})
    get_filename_component(FILE_NAME ${PROTO_FILE} NAME_WE)
    
    # Generate Protobuf sources
    add_custom_command(
        OUTPUT "${PROTO_GEN_DIR}/${FILE_NAME}.pb.cc" "${PROTO_GEN_DIR}/${FILE_NAME}.pb.h"
        COMMAND ${PROTOC_EXECUTABLE}
        ARGS --cpp_out "${PROTO_GEN_DIR}" -I "${PROTO_SRC_DIR}" -I "${PROTO_SRC_DIR}/vendor" "${PROTO_FILE}"
        DEPENDS "${PROTO_FILE}"
        COMMENT "Generating C++ code from ${FILE_NAME}.proto"
    )
    
    # Generate gRPC sources
    add_custom_command(
        OUTPUT "${PROTO_GEN_DIR}/${FILE_NAME}.grpc.pb.cc" "${PROTO_GEN_DIR}/${FILE_NAME}.grpc.pb.h"
        COMMAND ${PROTOC_EXECUTABLE}
        ARGS --grpc_out "${PROTO_GEN_DIR}" --plugin=protoc-gen-grpc=${GRPC_CPP_PLUGIN} -I "${PROTO_SRC_DIR}" -I "${PROTO_SRC_DIR}/vendor" "${PROTO_FILE}"
        DEPENDS "${PROTO_FILE}"
        COMMENT "Generating gRPC code from ${FILE_NAME}.proto"
    )

    list(APPEND PROTO_SRCS "${PROTO_GEN_DIR}/${FILE_NAME}.pb.cc" "${PROTO_GEN_DIR}/${FILE_NAME}.grpc.pb.cc")
    list(APPEND PROTO_HDRS "${PROTO_GEN_DIR}/${FILE_NAME}.pb.h" "${PROTO_GEN_DIR}/${FILE_NAME}.grpc.pb.h")
endforeach()

# Vendor Protos (compile only, no gRPC)
file(GLOB_RECURSE VENDOR_PROTO_FILES "${PROTO_SRC_DIR}/vendor/*.proto")
foreach(PROTO_FILE ${VENDOR_PROTO_FILES})
    get_filename_component(FILE_NAME_WE ${PROTO_FILE} NAME_WE)
    
    # Calculate relative path to determine output structure
    # We use PROTO_SRC_DIR/vendor as base for vendor files so they appear as buf/validate/...
    file(RELATIVE_PATH REL_FILE "${PROTO_SRC_DIR}/vendor" "${PROTO_FILE}")
    get_filename_component(REL_DIR ${REL_FILE} DIRECTORY)
    
    set(OUT_DIR "${PROTO_GEN_DIR}/${REL_DIR}")
    file(MAKE_DIRECTORY ${OUT_DIR})
    
    add_custom_command(
        OUTPUT "${OUT_DIR}/${FILE_NAME_WE}.pb.cc" "${OUT_DIR}/${FILE_NAME_WE}.pb.h"
        COMMAND ${PROTOC_EXECUTABLE}
        ARGS --cpp_out "${PROTO_GEN_DIR}" -I "${PROTO_SRC_DIR}/vendor" "${PROTO_FILE}"
        DEPENDS "${PROTO_FILE}"
        COMMENT "Generating C++ code from vendor ${FILE_NAME_WE}.proto"
    )
    
    list(APPEND PROTO_SRCS "${OUT_DIR}/${FILE_NAME_WE}.pb.cc")
    list(APPEND PROTO_HDRS "${OUT_DIR}/${FILE_NAME_WE}.pb.h")
endforeach()

# Create a library for the generated proto code
add_library(proto_lib STATIC ${PROTO_SRCS} ${PROTO_HDRS})
target_link_libraries(proto_lib PUBLIC protobuf::libprotobuf gRPC::grpc++)
target_include_directories(proto_lib PUBLIC ${PROTO_GEN_DIR})

# Sources
file(GLOB_RECURSE SOURCES "src/*.cpp")

add_executable(${PROJECT_NAME} ${SOURCES})

target_include_directories(${PROJECT_NAME} PRIVATE src)

# Link libraries
target_link_libraries(${PROJECT_NAME} PRIVATE
    Boost::system
    Boost::thread
    Boost::date_time
    fmt::fmt
    spdlog::spdlog
    nlohmann_json::nlohmann_json
    gRPC::grpc++
    protobuf::libprotobuf
    yaml-cpp
    proto_lib
)

# Compile definitions
target_compile_definitions(${PROJECT_NAME} PRIVATE
    BOOST_ASIO_NO_DEPRECATED
)
