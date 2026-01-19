#!/bin/bash
set -e

PROJECT_ROOT=~/rpi_odor
GEN_DIR=${PROJECT_ROOT}/gen/cpp
PROTO_DIR=${PROJECT_ROOT}/proto
TMP_DIR=/tmp/proto_clean

echo ">>> Cleaning and preparing directories..."
rm -rf ${GEN_DIR}
mkdir -p ${GEN_DIR}
rm -rf ${TMP_DIR}
mkdir -p ${TMP_DIR}

echo ">>> Stripping buf/validate annotations..."
python3 << 'PYEOF'
import re
import os
import glob

proto_dir = os.path.expanduser("~/rpi_odor/proto")
tmp_dir = "/tmp/proto_clean"

def remove_buf_validate_annotations(content):
    """Remove buf.validate annotations including those with nested braces."""
    result = []
    i = 0
    while i < len(content):
        # Check for start of annotation
        if content[i:i+2] == '[(': 
            # Look for buf.validate
            j = i + 2
            while j < len(content) and content[j] in ' \t':
                j += 1
            if content[j:j+13] == 'buf.validate.':
                # Found buf.validate annotation, find matching ]
                brace_count = 0
                k = i
                while k < len(content):
                    if content[k] == '[':
                        brace_count += 1
                    elif content[k] == ']':
                        brace_count -= 1
                        if brace_count == 0:
                            # Skip any leading whitespace before the annotation
                            while i > 0 and content[i-1] in ' \t':
                                i -= 1
                            i = k + 1
                            break
                    k += 1
                continue
        result.append(content[i])
        i += 1
    return ''.join(result)

for proto_file in glob.glob(f"{proto_dir}/*.proto"):
    with open(proto_file, 'r') as f:
        content = f.read()
    
    # Remove import statement
    content = re.sub(r'import\s+"buf/validate/validate\.proto";\s*\n?', '', content)
    # Remove comment about buf validate
    content = re.sub(r'//.*buf validate.*\n', '', content, flags=re.IGNORECASE)
    # Remove multi-line annotations
    content = remove_buf_validate_annotations(content)
    
    output_file = os.path.join(tmp_dir, os.path.basename(proto_file))
    with open(output_file, 'w') as f:
        f.write(content)
    print(f"  Processed: {os.path.basename(proto_file)}")
PYEOF

echo ">>> Generating C++ code with local protoc..."
/usr/local/bin/protoc \
    --cpp_out=${GEN_DIR} \
    --grpc_out=${GEN_DIR} \
    --plugin=protoc-gen-grpc=/usr/bin/grpc_cpp_plugin \
    -I${TMP_DIR} \
    ${TMP_DIR}/*.proto

echo ">>> Generated files:"
ls -la ${GEN_DIR}/

echo ">>> Done!"
