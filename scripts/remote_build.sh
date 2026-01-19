#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ROOT=~/rpi_odor
BUILD_DIR=${PROJECT_ROOT}/enose-control/build
PROTO_DIR=${PROJECT_ROOT}/proto
GEN_DIR=${PROJECT_ROOT}/gen/cpp

echo -e "${BLUE}>>> Activating environment...${NC}"
cd ${PROJECT_ROOT}
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi

echo -e "${BLUE}>>> Generating Protobuf code with buf...${NC}"
# Clean gen directory
rm -rf ${PROJECT_ROOT}/gen/cpp
mkdir -p ${PROJECT_ROOT}/gen/cpp

cd ${PROTO_DIR}
# Update buf dependencies
buf dep update
# Generate C++ code
buf generate

echo "  Generated files:"
ls -la ${GEN_DIR}/

echo -e "${BLUE}>>> Preparing build directory...${NC}"
mkdir -p ${BUILD_DIR}
cd ${BUILD_DIR}

echo -e "${BLUE}>>> Configuring (CMake)...${NC}"
cmake .. -DCMAKE_BUILD_TYPE=Debug

echo -e "${BLUE}>>> Building...${NC}"
cmake --build . -j$(nproc)

echo -e "${GREEN}>>> Build Complete! Executable is at ${BUILD_DIR}/bin/enose-control${NC}"
