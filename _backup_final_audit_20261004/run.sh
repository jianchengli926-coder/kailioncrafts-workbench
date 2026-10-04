#!/bin/bash
# KaiLionCrafts AI客户开发工作台 - 启动脚本
# 支持本地访问和局域网多人访问

cd "$(dirname "$0")"

# 检查Python
if ! command -v python3 &> /dev/null; then
    echo "❌ 未找到Python3，请先安装Python 3.9+"
    exit 1
fi

# 检查依赖
if ! python3 -c "import streamlit" 2>/dev/null; then
    echo "📦 正在安装依赖..."
    pip3 install -r requirements.txt
fi

# 检查.env
if [ ! -f .env ]; then
    echo "⚠️  未找到 .env 文件，复制 .env.example..."
    cp .env.example .env
    echo "   请编辑 .env 填入你的API密钥"
fi

# 加载环境变量
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# 获取本机局域网IP
LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)

echo "============================================"
echo "🚀 KaiLionCrafts AI客户开发工作台"
echo "============================================"
echo ""
echo "📱 本机访问:  http://localhost:8501"
if [ -n "$LOCAL_IP" ]; then
    echo "🌐 局域网访问: http://$LOCAL_IP:8501"
    echo "   (同事在同一WiFi/网络下可通过此地址访问)"
fi
echo ""
echo "💡 提示:"
echo "   - 按 Ctrl+C 停止服务"
echo "   - 首次使用请在「设置」中配置AI模型API"
echo "   - 知识库支持全文搜索，在「知识库」页面使用"
echo ""

# 启动服务，绑定0.0.0.0允许局域网访问
python3 -m streamlit run app.py \
    --server.port=8501 \
    --server.address=0.0.0.0 \
    --server.headless=false
