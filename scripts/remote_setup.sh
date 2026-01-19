#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}>>> Updating System Dependencies...${NC}"
apt-get update

echo -e "${GREEN}>>> Installing Basic Build Tools...${NC}"
apt-get install -y \
    build-essential \
    cmake \
    git \
    pkg-config

echo -e "${GREEN}>>> Installing Libraries (Batch 1: JSON, FMT, SpdLog, YAML)...${NC}"
apt-get install -y \
    libfmt-dev \
    libspdlog-dev \
    nlohmann-json3-dev \
    libyaml-cpp-dev

echo -e "${GREEN}>>> Installing Boost...${NC}"
apt-get install -y \
    libboost-dev \
    libboost-system-dev \
    libboost-thread-dev \
    libboost-date-time-dev

echo -e "${GREEN}>>> Installing Protobuf & gRPC...${NC}"
apt-get install -y \
    libgrpc++-dev \
    libprotobuf-dev \
    protobuf-compiler-grpc

echo -e "${GREEN}>>> Remote Setup Complete!${NC}"
