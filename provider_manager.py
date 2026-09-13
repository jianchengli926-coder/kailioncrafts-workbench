# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI工作台 - 多供应商管理模块
类似CC Switch，支持管理多个API中转站，一键切换
"""
import json
import requests
from pathlib import Path
from datetime import datetime

# 供应商配置文件
PROVIDERS_FILE = Path(__file__).parent / "data" / "ai_providers.json"


def ensure_providers_file():
    """确保供应商配置文件存在"""
    PROVIDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not PROVIDERS_FILE.exists():
        # 初始化默认供应商
        default_providers = {
            "providers": [
                {
                    "id": "ollama_local",
                    "name": "Ollama本地模型",
                    "type": "local",
                    "base_url": "http://localhost:11434/v1",
                    "api_key": "ollama",
                    "models": [],
                    "auto_detect": True,
                    "created_at": datetime.now().isoformat(),
                    "is_default": True,
                },
                {
                    "id": "doubao_default",
                    "name": "豆包（火山引擎）",
                    "type": "online",
                    "base_url": "https://ark.cn-beijing.volces.com/api/v3",
                    "api_key": "",
                    "models": [
                        "doubao-seed-2-1-turbo-260628",
                        "doubao-pro-32k",
                        "doubao-lite-32k",
                    ],
                    "auto_detect": False,
                    "created_at": datetime.now().isoformat(),
                    "is_default": False,
                },
            ],
            "active_provider": "doubao_default",
            "last_switch": datetime.now().isoformat(),
        }
        PROVIDERS_FILE.write_text(json.dumps(default_providers, ensure_ascii=False, indent=2), encoding='utf-8')
    return PROVIDERS_FILE


def load_providers():
    """加载所有供应商配置"""
    ensure_providers_file()
    with open(PROVIDERS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_providers(data):
    """保存供应商配置"""
    with open(PROVIDERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def add_provider(name, base_url, api_key, models=None, provider_type="online"):
    """添加新供应商"""
    data = load_providers()
    provider_id = f"custom_{len(data['providers'])}_{int(datetime.now().timestamp())}"

    provider = {
        "id": provider_id,
        "name": name,
        "type": provider_type,
        "base_url": base_url.rstrip('/'),
        "api_key": api_key,
        "models": models or [],
        "auto_detect": False,
        "created_at": datetime.now().isoformat(),
        "is_default": False,
    }

    # 尝试自动获取模型列表
    if api_key and base_url:
        try:
            resp = requests.get(
                f"{base_url.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10
            )
            if resp.status_code == 200:
                model_data = resp.json()
                if 'data' in model_data:
                    detected_models = [m['id'] for m in model_data['data']]
                    if detected_models:
                        provider['models'] = detected_models
                        provider['auto_detect'] = True
        except:
            pass

    data['providers'].append(provider)
    save_providers(data)
    return provider


def update_provider(provider_id, **kwargs):
    """更新供应商配置"""
    data = load_providers()
    for p in data['providers']:
        if p['id'] == provider_id:
            for key, value in kwargs.items():
                p[key] = value
            p['updated_at'] = datetime.now().isoformat()
            break
    save_providers(data)


def delete_provider(provider_id):
    """删除供应商"""
    data = load_providers()
    data['providers'] = [p for p in data['providers'] if p['id'] != provider_id]
    if data.get('active_provider') == provider_id:
        data['active_provider'] = data['providers'][0]['id'] if data['providers'] else None
    save_providers(data)


def set_active_provider(provider_id):
    """设置当前使用的供应商"""
    data = load_providers()
    data['active_provider'] = provider_id
    data['last_switch'] = datetime.now().isoformat()
    save_providers(data)

    # 返回供应商配置，供调用save_config使用
    for p in data['providers']:
        if p['id'] == provider_id:
            return p
    return None


def get_active_provider():
    """获取当前活跃的供应商"""
    data = load_providers()
    active_id = data.get('active_provider')
    for p in data['providers']:
        if p['id'] == active_id:
            return p
    return data['providers'][0] if data['providers'] else None


def detect_ollama_models():
    """自动检测Ollama本地模型"""
    try:
        resp = requests.get("http://localhost:11434/api/tags", timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            models = [m['name'] for m in data.get('models', [])]
            # 过滤掉嵌入模型，只保留对话模型
            chat_models = [m for m in models if 'embed' not in m.lower()]
            return chat_models
    except:
        pass
    return []


def refresh_ollama_models():
    """刷新Ollama模型列表到配置"""
    models = detect_ollama_models()
    if models:
        data = load_providers()
        for p in data['providers']:
            if p['id'] == 'ollama_local':
                p['models'] = models
                p['last_refresh'] = datetime.now().isoformat()
                break
        save_providers(data)
    return models


def test_provider(provider_id):
    """测试供应商连接"""
    data = load_providers()
    for p in data['providers']:
        if p['id'] == provider_id:
            try:
                # 测试模型列表接口
                resp = requests.get(
                    f"{p['base_url'].rstrip('/')}/models",
                    headers={"Authorization": f"Bearer {p['api_key']}"},
                    timeout=10
                )
                if resp.status_code == 200:
                    return {"success": True, "message": "连接成功", "status_code": 200}
                else:
                    return {"success": False, "message": f"连接失败: HTTP {resp.status_code}", "status_code": resp.status_code}
            except Exception as e:
                return {"success": False, "message": f"连接异常: {str(e)}", "status_code": 0}
    return {"success": False, "message": "供应商不存在", "status_code": 0}


def get_provider_stats():
    """获取供应商统计信息"""
    data = load_providers()
    return {
        "total": len(data['providers']),
        "online": len([p for p in data['providers'] if p['type'] == 'online']),
        "local": len([p for p in data['providers'] if p['type'] == 'local']),
        "active": data.get('active_provider'),
        "last_switch": data.get('last_switch'),
    }
