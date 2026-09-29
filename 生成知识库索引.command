#!/bin/bash
# KaiLionCrafts 知识库索引生成脚本 V77.0
# 一键执行：扫描完整版知识库并生成索引
# 知识库路径从 kb_config.json 读取，不再硬编码旧目录

cd "$(dirname "$0")"

echo "========================================"
echo "KaiLionCrafts 知识库索引生成 V77.0"
echo "========================================"
echo ""

# 检查 kb_config.json
if [ ! -f "kb_config.json" ]; then
    echo "❌ 错误：kb_config.json 不存在"
    echo "   请复制 kb_config.example.json 为 kb_config.json"
    echo "   并填写 kbRoot 为完整版知识库绝对路径。"
    echo ""
    read -p "按回车键退出..."
    exit 1
fi

# 从 kb_config.json 读取 kbRoot
KB_ROOT=$(python3 -c "import json; print(json.load(open('kb_config.json'))['kbRoot'])" 2>/dev/null)
if [ -z "$KB_ROOT" ] || [ ! -d "$KB_ROOT" ]; then
    echo "❌ 错误：kb_config.json 中的 kbRoot 无效"
    echo "   当前值: $KB_ROOT"
    echo "   请确认完整版知识库目录存在且可访问。"
    echo ""
    read -p "按回车键退出..."
    exit 1
fi

echo "📂 知识库路径: $KB_ROOT"
echo ""

# 检查Python3
if ! command -v python3 &> /dev/null; then
    echo "❌ 错误：未找到 python3"
    echo "   请安装 Python 3 后重试。"
    read -p "按回车键退出..."
    exit 1
fi

# 运行索引器
echo "🚀 开始生成索引..."
echo ""
python3 kb_indexer.py

echo ""
echo "========================================"
echo "✅ 索引生成完成"
echo "========================================"
echo "索引文件: $(pwd)/kb_index.json"
echo "文档清单: $(pwd)/kb_manifest.json"
echo "分类树:   $(pwd)/kb_tree.json"
echo "构建报告: $(pwd)/kb_build_report.json"
echo ""
echo "刷新浏览器页面即可加载最新索引。"
echo ""
read -p "按回车键关闭窗口..."
