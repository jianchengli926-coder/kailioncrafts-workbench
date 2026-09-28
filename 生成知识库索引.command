#!/bin/bash
# KaiLionCrafts 知识库索引生成脚本
# 一键执行：扫描知识库并生成索引

cd "$(dirname "$0")"

echo "========================================"
echo "KaiLionCrafts 知识库索引生成"
echo "========================================"
echo ""

# 检查知识库路径
KB_DIR="公司知识库备份_v5.7_2026-09-28"
if [ ! -d "$KB_DIR" ]; then
    echo "❌ 错误：知识库目录不存在"
    echo "   期望路径: $(pwd)/$KB_DIR"
    echo ""
    echo "请确认知识库文件夹是否在当前目录下。"
    read -p "按回车键退出..."
    exit 1
fi

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
echo ""
echo "刷新浏览器页面即可加载最新索引。"
echo ""
read -p "按回车键关闭窗口..."
