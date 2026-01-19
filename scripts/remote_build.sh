#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ROOT=~/rpi_odor
BUILD_DIR=${PROJECT_ROOT}/enose-control/build

echo -e "${BLUE}>>> Activating environment...${NC}"
cd ${PROJECT_ROOT}
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi

echo -e "${BLUE}>>> Preparing build directory...${NC}"
mkdir -p ${BUILD_DIR}
cd ${BUILD_DIR}

echo -e "${BLUE}>>> Configuring (CMake)...${NC}"
cmake .. -DCMAKE_BUILD_TYPE=Debug

echo -e "${BLUE}>>> Building...${NC}"
cmake --build .

echo -e "${GREEN}>>> Build Complete! Executable is at ${BUILD_DIR}/bin/enose-control${NC}"
