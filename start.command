#!/bin/bash
# ============================================================
# 锴利外贸获客工作台 - Mac本地服务器一键启动脚本
# ============================================================
# 使用方法：
#   1. 双击运行此脚本，或在终端执行: ./start.command
#   2. 浏览器自动打开 http://localhost:8080
#   3. 输入密码 441723 进入工作台
# ============================================================

# 获取脚本所在目录
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║   🚀 锴利外贸获客工作台 - 本地服务器启动中...              ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装 Node.js"
    echo "   下载地址: https://nodejs.org/"
    read -p "按回车键退出..."
    exit 1
fi
echo "✅ Node.js 已安装: $(node --version)"

# 检查Ollama
if command -v ollama &> /dev/null; then
    echo "✅ Ollama 已安装"
    # 检查Ollama服务是否运行
    if curl -s http://localhost:11434/api/tags &> /dev/null; then
        echo "✅ Ollama 服务运行中"
        # 列出本地模型
        echo "📦 本地模型:"
        curl -s http://localhost:11434/api/tags | python3 -c "
import json, sys
data = json.load(sys.stdin)
for m in data.get('models', []):
    name = m.get('name', '')
    if 'embed' not in name:
        size = m.get('size', 0) / (1024**3)
        print(f'   - {name} ({size:.1f}GB)')
" 2>/dev/null || echo "   (无法获取模型列表)"
    else
        echo "⚠️  Ollama 服务未运行，正在启动..."
        # 后台启动Ollama
        ollama serve &
        sleep 3
        if curl -s http://localhost:11434/api/tags &> /dev/null; then
            echo "✅ Ollama 服务已启动"
        else
            echo "❌ Ollama 服务启动失败，本地模型将不可用"
            echo "   请手动执行: ollama serve"
        fi
    fi
else
    echo "⚠️  未检测到 Ollama，本地模型将不可用"
    echo "   安装方法: brew install ollama"
    echo "   下载模型: ollama pull qwen2.5:7b"
fi

echo ""
echo "=========================================="
echo "  🌐 工作台访问地址"
echo "=========================================="
LAN_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | head -1 | awk '{print $2}')
echo "  💻 本机访问:   http://localhost:8080"
if [ -n "$LAN_IP" ]; then
echo "  🏠 局域网访问: http://$LAN_IP:8080"
else
echo "  🏠 局域网访问: 未检测到局域网IP"
fi
echo "  🌐 公网访问:   https://prospect.kailioncrafts.com"
echo "  🩺 健康检查:   http://localhost:8080/api/health"
echo "=========================================="
echo ""
echo "💡 提示:"
echo "  - 所有访问均需输入工作台密码（密码不在此显示）"
echo "  - 在线模型优先使用，全部失败时自动切换到本地模型"
echo "  - 关闭此终端窗口或按 Ctrl+C 后，本机/局域网/公网访问全部失效"
echo "  - 不配置 Cloudflare Access，公网运行期间登录页可见，请使用强密码并保留限速"
echo ""

# 端口检查
if lsof -i :8080 -P -n | grep -q LISTEN; then
    echo "⚠️  端口 8080 已被占用，可能已有工作台实例在运行"
    echo "   如确认无其他实例，可先执行: lsof -ti :8080 | xargs kill"
    read -p "仍要继续启动吗？(y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "已取消启动"
        read -p "按回车键退出..."
        exit 0
    fi
fi

# 延迟2秒后打开浏览器
(sleep 2 && open "http://localhost:8080") &

# 启动服务器（前台运行，关闭终端即停止）
echo "🚀 启动服务器..."
echo ""
node server.js

# 如果服务器退出
echo ""
echo "服务器已停止"
read -p "按回车键退出..."
