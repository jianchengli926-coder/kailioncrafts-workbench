#!/bin/bash
# V77.0 Phase 1.2: 知识库索引生成脚本
# 读取 kb_config.json，不再检查旧知识库目录
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 检查 python3 是否存在
if ! command -v python3 &> /dev/null; then
    echo "❌ 错误: 未找到 python3，请先安装 Python 3"
    exit 1
fi

# 检查 kb_config.json 是否存在
if [ ! -f "kb_config.json" ]; then
    echo "❌ 错误: kb_config.json 不存在，请先从 kb_config.example.json 复制并配置"
    exit 1
fi

echo "🔄 开始构建知识库索引..."
echo "📁 工作目录: $SCRIPT_DIR"

# 执行索引构建，检查退出码
if python3 kb_indexer.py; then
    echo "✅ 索引生成完成"
    exit 0
else
    echo "❌ 索引生成失败，请检查上方错误信息"
    exit 1
fi
