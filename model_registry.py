# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI工作台 - 模型注册表 v1.0
中央模型注册表：定义活动模型、路由顺序、健康状态、429冷却、禁用标记
所有模型路由以此文件为唯一真相来源，不再动态从 provider_manager 拼装。
"""
import time
import threading
from datetime import datetime
try:
    import requests
except ImportError:
    requests = None

# ============ 健康状态常量 ============
HEALTH_AVAILABLE = "available"        # 可用
HEALTH_RATE_LIMITED = "rate_limited"  # 限流(429)
HEALTH_TIMEOUT = "timeout"            # 超时
HEALTH_UNAVAILABLE = "unavailable"    # 暂时不可用
HEALTH_CONFIG_ERROR = "config_error"  # 配置错误
HEALTH_MANUAL_DISABLED = "manual_disabled"  # 手动禁用
HEALTH_UNKNOWN = "unknown"            # 未检测
HEALTH_RUNTIME_UNSUPPORTED = "runtime_unsupported"  # 运行时不支持（如Ollama版本不支持图像生成）
HEALTH_INSUFFICIENT_BALANCE = "insufficient_balance"  # 余额不足

HEALTH_LABELS = {
    HEALTH_AVAILABLE: "可用",
    HEALTH_RATE_LIMITED: "限流",
    HEALTH_TIMEOUT: "超时",
    HEALTH_UNAVAILABLE: "暂时不可用",
    HEALTH_CONFIG_ERROR: "配置错误",
    HEALTH_MANUAL_DISABLED: "手动禁用",
    HEALTH_UNKNOWN: "未检测",
    HEALTH_RUNTIME_UNSUPPORTED: "运行时不支持",
    HEALTH_INSUFFICIENT_BALANCE: "余额不足",
}

# Ollama 图像生成能力缓存（避免每次请求都探测）
_ollama_image_gen_capable = None
_ollama_image_gen_checked = False

# ============ 本地模型真实 Ollama ID（来自 ollama list） ============
# 这些是本机实际安装的模型名称，禁止猜测
LOCAL_MODELS = {
    "qwen3.5:9b": {
        "ollama_id": "qwen3.5:9b",
        "display_name": "qwen3.5:9b",
        "category": "text",
        "vision_capable": True,  # 经 ollama show 确认 Capabilities 含 vision
        "context_default": 8192,
        "context_long": 16384,
        "context_max": 32768,
        "size_gb": 6.6,
    },
    "deepseek-r1:7b": {
        "ollama_id": "deepseek-r1:7b",
        "display_name": "deepseek-r1:7b",
        "category": "text",
        "vision_capable": False,
        "context_default": 8192,
        "context_long": 16384,
        "context_max": 32768,
        "size_gb": 4.7,
    },
    "qwen2.5:7b": {
        "ollama_id": "qwen2.5:7b",
        "display_name": "qwen2.5:7b",
        "category": "text",
        "vision_capable": False,
        "context_default": 8192,
        "context_long": 16384,
        "context_max": 32768,
        "size_gb": 4.7,
    },
    "qwen2.5vl:7b": {
        "ollama_id": "qwen2.5vl:7b",
        "display_name": "qwen2.5vl:7b",
        "category": "vision",
        "vision_capable": True,
        "context_default": 8192,
        "context_long": 16384,
        "context_max": 32768,
        "size_gb": 6.0,
    },
    "x/flux2-klein:4b-fp4": {
        "ollama_id": "x/flux2-klein:4b-fp4",
        "display_name": "FLUX.2 Klein 4B",
        "category": "image",
        "vision_capable": False,
        "context_default": 0,
        "context_long": 0,
        "context_max": 0,
        "size_gb": 5.7,
    },
    "nomic-embed-text:latest": {
        "ollama_id": "nomic-embed-text:latest",
        "display_name": "nomic-embed-text",
        "category": "embedding",
        "vision_capable": False,
        "context_default": 8192,
        "context_long": 8192,
        "context_max": 8192,
        "size_gb": 0.27,
    },
}

# ============ 在线模型凭证来源（从 provider_manager 读取） ============
# 不硬编码 API Key，运行时从 ai_providers.json 加载
def _load_online_credentials():
    """从 provider_manager 加载在线模型 API 凭证"""
    creds = {}
    try:
        from provider_manager import load_providers
        data = load_providers()
        for p in data.get("providers", []):
            if p.get("disabled"):
                continue
            pid = p.get("id", "")
            creds[pid] = {
                "base_url": p.get("base_url", ""),
                "api_key": p.get("api_key", ""),
                "name": p.get("name", pid),
            }
    except Exception as e:
        import sys
        print(f"[model_registry] 加载在线凭证失败: {e}", file=sys.stderr)
    return creds


def _get_cred(creds, provider_id, fallback_url="", fallback_key=""):
    """安全获取凭证"""
    c = creds.get(provider_id, {})
    return {
        "base_url": c.get("base_url", fallback_url),
        "api_key": c.get("api_key", fallback_key),
    }


# ============ 活动模型注册表 ============
# 文本模型自动路由顺序（普通文本/聊天/Agent/工具调用）
# 严格4节点：GLM-4.7 -> GLM-4 -> qwen3.5:9b -> qwen2.5:7b
TEXT_CHAIN_IDS = [
    "glm-4.7-flash",       # 1. GLM-4.7 Flash
    "glm-4-flash",         # 2. GLM-4 Flash
    "qwen3.5:9b",          # 3. qwen3.5:9b（默认本地首选）
    "qwen2.5:7b",          # 4. qwen2.5:7b（本地文本备用）
]

# 推理任务链（GLM → qwen3.5 → deepseek-r1）
REASONING_CHAIN_IDS = [
    "glm-4.7-flash",       # 1. GLM-4.7 Flash
    "qwen3.5:9b",          # 2. qwen3.5:9b
    "deepseek-r1:7b",      # 3. deepseek-r1:7b（推理备用）
]

# 本地模型顺序（文本故障转移）
LOCAL_TEXT_CHAIN_IDS = [
    "qwen3.5:9b",
    "qwen2.5:7b",
]

# 本地推理链（qwen3.5 → deepseek-r1）
LOCAL_REASONING_CHAIN_IDS = [
    "qwen3.5:9b",
    "deepseek-r1:7b",
]

# 视觉模型自动路由顺序
VISION_CHAIN_IDS = [
    "glm-4.6v-flash",      # 1. GLM-4.6V Flash
    "qwen3.5:9b",          # 2. qwen3.5:9b（已确认支持视觉）
    "qwen2.5vl:7b",        # 3. qwen2.5vl:7b
]

# 图像生成模型自动路由顺序
IMAGE_CHAIN_IDS = [
    "cogview-3-flash",     # 1. GLM/CogView 云端
    "x/flux2-klein:4b-fp4",  # 2. FLUX.2 Klein 4B 本地
]

# Embedding 固定
EMBEDDING_MODEL_ID = "nomic-embed-text:latest"

# 被禁用/移出活动注册表的在线模型（保留 API Key 和历史配置，不发请求）
DISABLED_ONLINE_PROVIDERS = [
    "sf_xing4_29b",       # SiliconFlow Xing4.0-29B
    "sf_qwen2_7b",        # SiliconFlow Qwen2.5-7B
]


def build_model_registry():
    """
    构建完整活动模型注册表。
    运行时调用，每次读取最新凭证。
    Returns:
        dict: {model_id: model_info}
    """
    creds = _load_online_credentials()
    zhipu = _get_cred(creds, "zhipu_glm47_flash",
                      fallback_url="https://open.bigmodel.cn/api/paas/v4")
    # GLM 系列共用同一套智谱凭证
    zhipu4 = _get_cred(creds, "zhipu_glm4_flash",
                       fallback_url=zhipu["base_url"],
                       fallback_key=zhipu["api_key"])
    zhipu46v = _get_cred(creds, "zhipu_glm46v_flash",
                         fallback_url=zhipu["base_url"],
                         fallback_key=zhipu["api_key"])
    doubao = _get_cred(creds, "doubao_seed2_turbo",
                       fallback_url="https://ark.cn-beijing.volces.com/api/v3")

    registry = {}

    # --- 在线文本模型 ---
    registry["glm-4.7-flash"] = {
        "id": "glm-4.7-flash",
        "display_name": "GLM-4.7 Flash",
        "type": "online",
        "category": "text",
        "base_url": zhipu["base_url"],
        "api_key": zhipu["api_key"],
        "api_model": "glm-4.7-flash",
        "vision_capable": False,
        "provider": "zhipu",
    }
    registry["glm-4-flash"] = {
        "id": "glm-4-flash",
        "display_name": "GLM-4 Flash",
        "type": "online",
        "category": "text",
        "base_url": zhipu4["base_url"] or zhipu["base_url"],
        "api_key": zhipu4["api_key"] or zhipu["api_key"],
        "api_model": "glm-4-flash",
        "vision_capable": False,
        "provider": "zhipu",
    }
    registry["doubao-seed-2-1-turbo"] = {
        "id": "doubao-seed-2-1-turbo",
        "display_name": "豆包主模型",
        "type": "online",
        "category": "text",
        "base_url": doubao["base_url"],
        "api_key": doubao["api_key"],
        "api_model": "doubao-seed-2-1-turbo-260628",
        "vision_capable": False,
        "provider": "doubao",
    }

    # --- 在线视觉模型 ---
    registry["glm-4.6v-flash"] = {
        "id": "glm-4.6v-flash",
        "display_name": "GLM-4.6V Flash",
        "type": "online",
        "category": "vision",
        "base_url": zhipu46v["base_url"] or zhipu["base_url"],
        "api_key": zhipu46v["api_key"] or zhipu["api_key"],
        "api_model": "glm-4.6v-flash",
        "vision_capable": True,
        "provider": "zhipu",
    }

    # --- 在线图像生成 ---
    registry["cogview-3-flash"] = {
        "id": "cogview-3-flash",
        "display_name": "GLM/CogView",
        "type": "online",
        "category": "image",
        "base_url": zhipu["base_url"],
        "api_key": zhipu["api_key"],
        "api_model": "cogview-3-flash",
        "vision_capable": False,
        "provider": "zhipu",
    }

    # --- 本地模型 ---
    for mid, minfo in LOCAL_MODELS.items():
        if minfo["category"] == "embedding":
            continue  # embedding 单独处理
        registry[mid] = {
            "id": mid,
            "display_name": minfo["display_name"],
            "type": "local",
            "category": minfo["category"],
            "base_url": "http://localhost:11434",
            "api_key": "ollama",
            "api_model": minfo["ollama_id"],
            "vision_capable": minfo["vision_capable"],
            "provider": "ollama",
            "context_default": minfo["context_default"],
            "context_long": minfo["context_long"],
            "context_max": minfo["context_max"],
            "size_gb": minfo["size_gb"],
        }

    return registry


# ============ 健康状态管理器（线程安全） ============
class HealthManager:
    """
    线程安全的模型健康状态管理器。
    跟踪每个模型的健康状态、429冷却、响应时间、最近检测时间。
    """
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._states = {}  # model_id -> state dict
        self._state_lock = threading.Lock()

    def _ensure(self, model_id):
        if model_id not in self._states:
            self._states[model_id] = {
                "status": HEALTH_UNKNOWN,
                "last_check": None,
                "last_elapsed": None,
                "rate_limit_count": 0,
                "cooldown_until": 0,
                "last_error": None,
                "failover_count": 0,
                "last_failover_reason": None,
            }

    def set_status(self, model_id, status, elapsed=None, error=None):
        """设置模型健康状态"""
        with self._state_lock:
            self._ensure(model_id)
            s = self._states[model_id]
            s["status"] = status
            s["last_check"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            if elapsed is not None:
                s["last_elapsed"] = round(elapsed, 2)
            if error:
                s["last_error"] = str(error)[:200]
            if status == HEALTH_RATE_LIMITED:
                s["rate_limit_count"] += 1
                # 第一次429冷却60秒，连续第二次300秒
                cooldown = 60 if s["rate_limit_count"] == 1 else 300
                s["cooldown_until"] = time.time() + cooldown
            elif status == HEALTH_AVAILABLE:
                s["rate_limit_count"] = 0
                s["cooldown_until"] = 0
                s["last_error"] = None

    def record_failover(self, model_id, reason):
        """记录故障转移"""
        with self._state_lock:
            self._ensure(model_id)
            self._states[model_id]["failover_count"] += 1
            self._states[model_id]["last_failover_reason"] = reason

    def get_status(self, model_id):
        """获取模型状态摘要"""
        with self._state_lock:
            self._ensure(model_id)
            s = dict(self._states[model_id])
            # 检查冷却是否已过
            if s["cooldown_until"] > 0 and time.time() > s["cooldown_until"]:
                s["cooldown_remaining"] = 0
                # 冷却过后允许健康检查恢复，但不自动改状态
            else:
                s["cooldown_remaining"] = max(0, int(s["cooldown_until"] - time.time()))
            s["status_label"] = HEALTH_LABELS.get(s["status"], s["status"])
            return s

    def is_available(self, model_id):
        """模型是否当前可用（考虑冷却和运行时支持）"""
        s = self.get_status(model_id)
        if s["status"] in (HEALTH_CONFIG_ERROR, HEALTH_MANUAL_DISABLED, HEALTH_RUNTIME_UNSUPPORTED, HEALTH_INSUFFICIENT_BALANCE):
            return False
        if s["status"] == HEALTH_RATE_LIMITED and s["cooldown_remaining"] > 0:
            return False
        return True

    def get_all_statuses(self):
        """获取所有模型状态"""
        registry = build_model_registry()
        result = {}
        for mid in registry:
            result[mid] = self.get_status(mid)
        return result

    def reset_cooldown(self, model_id):
        """手动重置冷却（健康检查恢复后调用）"""
        with self._state_lock:
            self._ensure(model_id)
            self._states[model_id]["rate_limit_count"] = 0
            self._states[model_id]["cooldown_until"] = 0


# 全局健康管理器单例
health = HealthManager()


# ============ 路由链获取函数 ============
def get_text_chain():
    """获取文本模型自动路由链（按顺序，过滤不可用模型）"""
    registry = build_model_registry()
    chain = []
    for mid in TEXT_CHAIN_IDS:
        if mid in registry:
            chain.append(registry[mid])
    return chain


def get_vision_chain():
    """获取视觉模型自动路由链"""
    registry = build_model_registry()
    chain = []
    for mid in VISION_CHAIN_IDS:
        if mid in registry and registry[mid].get("vision_capable", False):
            chain.append(registry[mid])
    return chain


def check_ollama_image_gen_support(force=False):
    """
    检测当前 Ollama 运行时是否支持图像生成模型。
    发送最小生成探测，根据返回判断。结果缓存避免重复探测。
    Returns:
        tuple: (supported: bool, reason: str)
    """
    global _ollama_image_gen_capable, _ollama_image_gen_checked
    if _ollama_image_gen_checked and not force:
        return (_ollama_image_gen_capable, "cached")
    try:
        import requests as _req
        # 用 FLUX 模型发送最小生成探测
        resp = _req.post("http://localhost:11434/api/generate", json={
            "model": "x/flux2-klein:4b-fp4",
            "prompt": ".",
            "stream": False,
            "keep_alive": 0,
        }, timeout=15)
        if resp.status_code == 200:
            _ollama_image_gen_capable = True
            _ollama_image_gen_checked = True
            return (True, "ok")
        elif "image generation models are not currently supported" in resp.text:
            _ollama_image_gen_capable = False
            _ollama_image_gen_checked = True
            return (False, "Ollama运行时不支持图像生成模型")
        elif resp.status_code == 404:
            _ollama_image_gen_capable = False
            _ollama_image_gen_checked = True
            return (False, "FLUX模型未安装")
        else:
            _ollama_image_gen_capable = False
            _ollama_image_gen_checked = True
            return (False, f"HTTP {resp.status_code}: {resp.text[:100]}")
    except Exception as e:
        _ollama_image_gen_capable = False
        _ollama_image_gen_checked = True
        return (False, f"探测失败: {str(e)[:100]}")


def get_image_chain():
    """获取图像生成模型自动路由链（过滤运行时不支持的本地模型）"""
    registry = build_model_registry()
    chain = []
    for mid in IMAGE_CHAIN_IDS:
        if mid in registry:
            m = registry[mid]
            # 本地图像模型需检查运行时支持
            if m.get("type") == "local" and m.get("category") == "image":
                supported, reason = check_ollama_image_gen_support()
                if not supported:
                    health.set_status(mid, HEALTH_RUNTIME_UNSUPPORTED, error=reason)
                    continue
            chain.append(m)
    return chain


def get_local_text_chain():
    """获取本地文本模型链"""
    registry = build_model_registry()
    chain = []
    for mid in LOCAL_TEXT_CHAIN_IDS:
        if mid in registry:
            chain.append(registry[mid])
    return chain


def get_reasoning_chain():
    """获取推理任务自动路由链"""
    registry = build_model_registry()
    chain = []
    for mid in REASONING_CHAIN_IDS:
        if mid in registry:
            chain.append(registry[mid])
    return chain


def get_local_reasoning_chain():
    """获取本地推理模型链"""
    registry = build_model_registry()
    chain = []
    for mid in LOCAL_REASONING_CHAIN_IDS:
        if mid in registry:
            chain.append(registry[mid])
    return chain


def get_model_info(model_id):
    """获取单个模型信息"""
    registry = build_model_registry()
    return registry.get(model_id)


def get_embedding_model():
    """获取 Embedding 模型信息"""
    return LOCAL_MODELS.get(EMBEDDING_MODEL_ID, {})


def get_disabled_providers():
    """获取被禁用的在线供应商列表"""
    return list(DISABLED_ONLINE_PROVIDERS)


def is_model_in_active_chain(model_id, chain_type="text"):
    """检查模型是否在活动路由链中"""
    if chain_type == "text":
        return model_id in TEXT_CHAIN_IDS
    elif chain_type == "reasoning":
        return model_id in REASONING_CHAIN_IDS
    elif chain_type == "vision":
        return model_id in VISION_CHAIN_IDS
    elif chain_type == "image":
        return model_id in IMAGE_CHAIN_IDS
    return False
