# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - AI调用模块 v5.0
基于模型注册表的统一路由：文本/视觉/图像生成三类故障转移链
v5.0 新增：
- 中央模型注册表（model_registry）驱动路由，不再动态拼装
- 错误分类：401/403/参数错误不自动切换，408/429/5xx/超时/网络错误才切换
- GLM/豆包 30秒超时、连续两次15秒慢响应触发切换
- 429 冷却：第一次60秒，连续第二次300秒
- 本地模型全局互斥锁（local_model_manager），同一时刻只加载一个大模型
- 本地模型使用 Ollama 原生 API，控制 num_ctx（8192/16384/32768），keep_alive:0 释放
- 视觉路由：GLM-4.6V Flash → qwen3.5:9b（已确认支持视觉）→ qwen2.5vl:7b
- 图像生成路由：CogView → FLUX.2 Klein 4B（Ollama 原生 /api/generate）
- 手动模型选择（per-task，不改全局默认）
- 增强 Trace：原模型/目标模型/在线本地/状态码/耗时/切换时间/自动手动/锁状态
- 非视觉模型拒收图片输入
"""
import json
import time
import base64
import requests
from pathlib import Path
from datetime import datetime

from config import (
    AI_PROVIDER, DOUBAO_API_KEY, DOUBAO_BASE_URL, DOUBAO_MODEL, DOUBAO_MODEL_LITE,
    OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_MODEL_LITE,
    ALL_PROVIDERS,
)
from prompts import SYSTEM_PROMPT
from model_registry import (
    build_model_registry, get_text_chain, get_vision_chain, get_image_chain,
    health, HEALTH_AVAILABLE, HEALTH_RATE_LIMITED, HEALTH_TIMEOUT,
    HEALTH_UNAVAILABLE, HEALTH_CONFIG_ERROR,
)
from local_model_manager import local_model_manager

TRACE_DIR = Path(__file__).parent / "data" / "trace"
TRACE_DIR.mkdir(parents=True, exist_ok=True)

# 可自动故障转移的 HTTP 状态码
FAILOVER_STATUS_CODES = {408, 429, 500, 502, 503, 504}
# 不可自动切换、必须显示明确错误的状态码
NO_FAILOVER_STATUS_CODES = {401, 403}

# 在线模型超时阈值
ONLINE_TIMEOUT = 180
# GLM/豆包单次请求超过此秒数触发切换
GLM_DOUBAO_SLOW_THRESHOLD = 30
# 连续两次响应超过此秒数触发切换
SLOW_RESPONSE_THRESHOLD = 15
# 慢响应跟踪（model_id -> [最近响应时间列表]）
_slow_response_tracker = {}


def _is_slow_response(model_id, elapsed):
    """检查是否触发慢响应切换规则：连续两次超过15秒"""
    if model_id not in _slow_response_tracker:
        _slow_response_tracker[model_id] = []
    tracker = _slow_response_tracker[model_id]
    tracker.append(elapsed)
    if len(tracker) > 5:
        tracker.pop(0)
    # 连续两次超过阈值
    if len(tracker) >= 2 and tracker[-1] > SLOW_RESPONSE_THRESHOLD and tracker[-2] > SLOW_RESPONSE_THRESHOLD:
        return True
    return False


def _classify_error(exception, status_code=None):
    """
    分类错误，判断是否可自动故障转移。
    Returns:
        tuple: (can_failover: bool, error_type: str, error_msg: str)
    """
    if status_code:
        if status_code in NO_FAILOVER_STATUS_CODES:
            return False, "auth_error", f"HTTP {status_code}：认证/权限错误，需检查API Key"
        if status_code in FAILOVER_STATUS_CODES:
            return True, f"http_{status_code}", f"HTTP {status_code}"
        if status_code == 400:
            return False, "param_error", "HTTP 400：请求参数错误"
        if status_code == 422:
            return False, "param_error", "HTTP 422：参数验证失败"
        # 其他状态码默认不切换
        return False, "unknown_http", f"HTTP {status_code}"

    err_str = str(exception).lower()
    if isinstance(exception, requests.exceptions.Timeout):
        return True, "timeout", "请求超时"
    if isinstance(exception, requests.exceptions.ConnectionError):
        return True, "connection_error", "网络连接失败"
    if "timeout" in err_str:
        return True, "timeout", "请求超时"
    if "connection" in err_str or "connect" in err_str:
        return True, "connection_error", "网络连接失败"
    if "model not found" in err_str or "model does not exist" in err_str:
        return True, "model_not_found", "模型不存在"
    if "service unavailable" in err_str or "temporarily unavailable" in err_str:
        return True, "unavailable", "服务暂时不可用"
    if "invalid api key" in err_str or "unauthorized" in err_str or "401" in err_str:
        return False, "auth_error", "API Key 错误或未授权"
    if "forbidden" in err_str or "403" in err_str:
        return False, "auth_error", "访问被拒绝(403)"
    if "content" in err_str and ("filter" in err_str or "moderation" in err_str or "audit" in err_str or "reject" in err_str):
        return False, "content_rejected", "内容审核拒绝"
    if "empty" in err_str and "input" in err_str:
        return False, "empty_input", "用户输入为空"
    # 默认不切换
    return False, "unknown", str(exception)[:100]


class AIClient:
    """AI客户端 - 基于模型注册表的统一路由 + 故障转移 + 本地互斥锁"""

    def __init__(self):
        self.provider = AI_PROVIDER
        if self.provider == "doubao":
            self.api_key = DOUBAO_API_KEY
            self.base_url = DOUBAO_BASE_URL
            self.model = DOUBAO_MODEL
            self.model_lite = DOUBAO_MODEL_LITE
        else:
            self.api_key = OPENAI_API_KEY
            self.base_url = OPENAI_BASE_URL
            self.model = OPENAI_MODEL
            self.model_lite = OPENAI_MODEL_LITE or OPENAI_MODEL
        self.timeout = ONLINE_TIMEOUT
        self.last_trace = None
        # 预构建注册表（运行时可刷新）
        self._registry = build_model_registry()
        # 会话级手动模型覆盖（由前端设置，per-session 生效，不改全局默认）
        self.manual_text_model = None
        self.manual_vision_model = None

    def refresh_registry(self):
        """刷新模型注册表（凭证变更后调用）"""
        self._registry = build_model_registry()
        return self._registry

    def get_failover_chain(self):
        """获取文本故障转移链（兼容旧接口）"""
        chain = []
        for m in get_text_chain():
            chain.append({
                "base_url": m["base_url"],
                "api_key": m["api_key"],
                "model": m["api_model"],
                "label": f"{m['display_name']}",
                "type": m["type"],
                "id": m["id"],
            })
        return chain

    def get_vision_chain(self):
        """获取视觉故障转移链"""
        chain = []
        for m in get_vision_chain():
            chain.append({
                "base_url": m["base_url"],
                "api_key": m["api_key"],
                "model": m["api_model"],
                "label": m["display_name"],
                "type": m["type"],
                "id": m["id"],
            })
        return chain

    def get_image_chain(self):
        """获取图像生成故障转移链"""
        chain = []
        for m in get_image_chain():
            chain.append({
                "base_url": m["base_url"],
                "api_key": m["api_key"],
                "model": m["api_model"],
                "label": m["display_name"],
                "type": m["type"],
                "id": m["id"],
            })
        return chain

    def get_provider_name(self):
        return ALL_PROVIDERS.get(self.provider, {}).get("name", self.provider)

    def is_configured(self):
        # 只要注册表中有可用的在线模型或本地模型即可
        chain = get_text_chain()
        return len(chain) > 0

    def update_config(self, provider=None, api_key=None, base_url=None, model=None, model_lite=None):
        if provider:
            self.provider = provider
        if api_key:
            self.api_key = api_key
        if base_url:
            self.base_url = base_url
        if model:
            self.model = model
        if model_lite:
            self.model_lite = model_lite
        self.refresh_registry()

    def test_connection(self, provider=None, api_key=None, base_url=None, model=None):
        """测试单个模型连接"""
        test_key = api_key or self.api_key
        test_url = base_url or self.base_url
        test_model = model or self.model
        if not test_key:
            return False, "API Key为空"
        try:
            resp = requests.post(
                f"{test_url}/chat/completions",
                headers={"Authorization": f"Bearer {test_key}", "Content-Type": "application/json"},
                json={"model": test_model, "messages": [{"role": "user", "content": "你好，请回复连接成功"}], "max_tokens": 50},
                timeout=60,
            )
            if resp.status_code == 200:
                content = resp.json()["choices"][0]["message"].get("content", "")
                return True, f"连接成功！模型回复：{content[:50]}"
            return False, f"连接失败：HTTP {resp.status_code} - {resp.text[:100]}"
        except requests.exceptions.Timeout:
            return False, "连接超时"
        except Exception as e:
            return False, f"连接失败：{str(e)[:100]}"

    # ============ Trace 记录 ============
    def _save_trace(self, trace):
        try:
            trace_file = TRACE_DIR / f"trace_{datetime.now().strftime('%Y%m')}.json"
            data = []
            if trace_file.exists():
                data = json.loads(trace_file.read_text(encoding="utf-8"))
            data.append(trace)
            trace_file.write_text(json.dumps(data[-500:], ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    def _build_trace(self, task_name, user_prompt, content, usage, start_time,
                     used_model, used_label, failover_log, status, error,
                     failover_details=None, local_lock_status=None, mode="auto"):
        elapsed = time.time() - start_time
        trace = {
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "task": task_name or "未命名任务",
            "model": used_model or "unknown",
            "provider": used_label or "unknown",
            "elapsed_seconds": round(elapsed, 2),
            "prompt_chars": len(user_prompt) if user_prompt else 0,
            "completion_chars": len(content) if content else 0,
            "prompt_tokens": usage.get("prompt_tokens", "N/A") if usage else "N/A",
            "completion_tokens": usage.get("completion_tokens", "N/A") if usage else "N/A",
            "total_tokens": usage.get("total_tokens", "N/A") if usage else "N/A",
            "knowledge_refs": [],
            "status": status,
            "error": error,
            "failover": failover_log if failover_log else None,
            "failover_count": len(failover_log) if failover_log else 0,
            "mode": mode,  # auto / manual
            "failover_details": failover_details or [],
            "local_lock_status": local_lock_status,
        }
        self.last_trace = trace
        self._save_trace(trace)
        return trace

    # ============ 在线模型调用（OpenAI 兼容） ============
    def _call_online_chat(self, model_info, messages, temperature=0.7, max_tokens=4000):
        """调用在线模型（OpenAI 兼容接口）"""
        resp = requests.post(
            f"{model_info['base_url'].rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {model_info['api_key']}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_info["api_model"],
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
            timeout=self.timeout,
        )
        return resp

    # ============ 本地模型调用（Ollama 原生 API） ============
    def _call_local_chat(self, model_info, messages, temperature=0.7, num_ctx=None):
        """
        调用本地模型（Ollama 原生 /api/chat）。
        使用 keep_alive: 0 在请求后立即释放模型。
        控制 num_ctx 避免 16GB 内存溢出。
        """
        if num_ctx is None:
            num_ctx = model_info.get("context_default", 8192)
        # 确保不超过模型最大允许
        max_ctx = model_info.get("context_max", 32768)
        num_ctx = min(num_ctx, max_ctx)

        resp = requests.post(
            f"{model_info['base_url'].rstrip('/')}/api/chat",
            json={
                "model": model_info["api_model"],
                "messages": messages,
                "stream": False,
                "keep_alive": 0,  # 请求后立即卸载
                "options": {
                    "temperature": temperature,
                    "num_ctx": num_ctx,
                },
            },
            timeout=self.timeout,
        )
        return resp

    def _parse_local_chat_response(self, resp):
        """解析 Ollama 原生 /api/chat 响应"""
        data = resp.json()
        msg = data.get("message", {})
        content = msg.get("content", "")
        # 推理模型可能有 thinking 内容
        if not content or len(content.strip()) < 2:
            thinking = msg.get("thinking", "")
            if thinking:
                content = f"[推理模型响应]\n\n{content or '（模型推理较长，请重试获取完整答案）'}"
        usage = data.get("eval_count", 0)
        usage_dict = {
            "prompt_tokens": data.get("prompt_eval_count", "N/A"),
            "completion_tokens": data.get("eval_count", "N/A"),
            "total_tokens": "N/A",
        }
        return content, usage_dict

    # ============ 本地 FLUX 图像生成 ============
    def _call_local_image(self, model_info, prompt):
        """
        调用本地 FLUX 模型生成图像（Ollama 原生 /api/generate）。
        Returns:
            dict: {"success": bool, "image_b64": str, "error": str}
        """
        try:
            resp = requests.post(
                f"{model_info['base_url'].rstrip('/')}/api/generate",
                json={
                    "model": model_info["api_model"],
                    "prompt": prompt,
                    "stream": False,
                    "keep_alive": 0,  # 生成后立即卸载
                },
                timeout=300,  # 图像生成可能较慢
            )
            if resp.status_code != 200:
                return {"success": False, "image_b64": None, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
            data = resp.json()
            images = data.get("images", [])
            if not images:
                return {"success": False, "image_b64": None, "error": "FLUX未返回图像数据"}
            return {"success": True, "image_b64": images[0], "error": None}
        except requests.exceptions.Timeout:
            return {"success": False, "image_b64": None, "error": "FLUX生成超时"}
        except Exception as e:
            return {"success": False, "image_b64": None, "error": str(e)[:200]}

    # ============ 核心：文本聊天 ============
    def chat(self, user_prompt, system_prompt=None, use_lite=False, temperature=0.7,
             max_retries=2, task_name=None, knowledge_refs=None, manual_model=None):
        """
        文本聊天/Agent/工具调用统一入口。
        Args:
            manual_model: 手动选择的模型ID（如 'qwen3.5:9b'），为None则自动路由。
                          手动选择只对本次请求生效，不改变全局默认顺序。
        """
        if not user_prompt or not user_prompt.strip():
            return "[错误] 用户输入为空，请输入内容后重试。"

        if not self.is_configured():
            return self._demo_response(user_prompt)

        messages = [
            {"role": "system", "content": system_prompt or SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        start_time = time.time()
        failover_log = []
        failover_details = []
        content = None
        usage = {}
        used_model = None
        used_label = None
        last_error = None
        mode = "manual" if manual_model else "auto"
        local_lock_status = None

        # 构建尝试链
        if manual_model is None:
            manual_model = self.manual_text_model
        if manual_model:
            # 手动模式：只尝试指定模型，不自动切换
            registry = build_model_registry()
            if manual_model in registry:
                attempt_chain = [registry[manual_model]]
            else:
                return f"[错误] 手动选择的模型 '{manual_model}' 不在活动注册表中。"
        else:
            # 自动模式：按注册表顺序
            attempt_chain = get_text_chain()

        for idx, model_info in enumerate(attempt_chain):
            model_id = model_info["id"]
            label = model_info["display_name"]
            mtype = model_info["type"]

            # 健康检查：冷却中的模型跳过
            if not health.is_available(model_id):
                st = health.get_status(model_id)
                skip_reason = st.get("status_label", "不可用")
                failover_log.append(f"{label} 跳过({skip_reason})")
                failover_details.append({
                    "from": attempt_chain[0]["display_name"] if idx > 0 else None,
                    "to": label,
                    "type": mtype,
                    "status_code": None,
                    "reason": f"健康状态:{skip_reason}",
                    "elapsed": 0,
                    "time": datetime.now().strftime("%H:%M:%S"),
                    "mode": mode,
                })
                continue

            req_start = time.time()
            try:
                if mtype == "local":
                    # 本地模型：获取全局互斥锁
                    lock_acquired = local_model_manager.acquire(model_info["api_model"], timeout=300)
                    if not lock_acquired:
                        failover_log.append(f"{label} 锁等待超时")
                        failover_details.append({
                            "from": None, "to": label, "type": "local",
                            "status_code": None, "reason": "本地模型锁等待超时",
                            "elapsed": 0, "time": datetime.now().strftime("%H:%M:%S"), "mode": mode,
                        })
                        continue
                    local_lock_status = "acquired"
                    try:
                        # 确认目标模型已加载（发送请求会自动加载）
                        resp = self._call_local_chat(model_info, messages, temperature)
                        req_elapsed = time.time() - req_start
                        if resp.status_code != 200:
                            raise Exception(f"HTTP {resp.status_code}: {resp.text[:120]}")
                        content, usage = self._parse_local_chat_response(resp)
                    finally:
                        # 释放锁（内部会卸载模型并验证）
                        local_model_manager.release(model_info["api_model"])
                        local_lock_status = "released"
                else:
                    # 在线模型
                    resp = self._call_online_chat(model_info, messages, temperature)
                    req_elapsed = time.time() - req_start
                    if resp.status_code != 200:
                        raise Exception(f"HTTP {resp.status_code}: {resp.text[:120]}")
                    data = resp.json()
                    msg = data["choices"][0]["message"]
                    content = msg.get("content", "")
                    usage = data.get("usage", {})
                    if (not content or len(content.strip()) < 2) and msg.get("reasoning_content"):
                        content = f"[推理模型响应]\n\n{content or '（模型推理较长，请重试获取完整答案）'}"

                # 成功处理
                if content and len(content.strip()) >= 2:
                    used_model = model_info["api_model"]
                    used_label = label
                    health.set_status(model_id, HEALTH_AVAILABLE, elapsed=req_elapsed)

                    # 慢响应检测（仅在线 GLM/豆包）
                    if mtype == "online" and model_info.get("provider") in ("zhipu", "doubao"):
                        if req_elapsed > GLM_DOUBAO_SLOW_THRESHOLD:
                            failover_log.append(f"{label} 响应过慢({req_elapsed:.1f}s>30s)")
                            # 不中断已成功的响应，但记录
                        elif _is_slow_response(model_id, req_elapsed):
                            failover_log.append(f"{label} 连续两次慢响应(>{SLOW_RESPONSE_THRESHOLD}s)")

                    if idx > 0 or manual_model is None:
                        if idx > 0:
                            failover_log.append(f"故障转移: {attempt_chain[0]['display_name']} -> {label}")
                    break
                else:
                    raise Exception("模型返回空内容")

            except Exception as e:
                req_elapsed = time.time() - req_start
                status_code = None
                if "HTTP " in str(e):
                    try:
                        status_code = int(str(e).split("HTTP ")[1].split(":")[0])
                    except (ValueError, IndexError):
                        pass

                can_failover, error_type, error_msg = _classify_error(e, status_code)
                last_error = f"{label}: {error_msg}"

                # 更新健康状态
                if status_code == 429:
                    health.set_status(model_id, HEALTH_RATE_LIMITED, elapsed=req_elapsed, error=error_msg)
                elif error_type == "timeout":
                    health.set_status(model_id, HEALTH_TIMEOUT, elapsed=req_elapsed, error=error_msg)
                elif can_failover:
                    health.set_status(model_id, HEALTH_UNAVAILABLE, elapsed=req_elapsed, error=error_msg)
                elif error_type in ("auth_error", "param_error"):
                    health.set_status(model_id, HEALTH_CONFIG_ERROR, elapsed=req_elapsed, error=error_msg)

                # 记录故障转移详情
                if idx < len(attempt_chain) - 1 and can_failover:
                    next_model = attempt_chain[idx + 1]["display_name"]
                    health.record_failover(model_id, error_msg)
                    failover_log.append(f"{label} 失败({error_msg}) -> {next_model}")
                    failover_details.append({
                        "from": label,
                        "to": next_model,
                        "type": mtype,
                        "status_code": status_code,
                        "reason": error_msg,
                        "elapsed": round(req_elapsed, 2),
                        "time": datetime.now().strftime("%H:%M:%S"),
                        "mode": mode,
                    })
                else:
                    failover_log.append(f"{label} 失败({error_msg})")
                    failover_details.append({
                        "from": label, "to": None, "type": mtype,
                        "status_code": status_code, "reason": error_msg,
                        "elapsed": round(req_elapsed, 2),
                        "time": datetime.now().strftime("%H:%M:%S"), "mode": mode,
                    })

                # 不可自动切换的错误：立即停止，显示明确错误
                if not can_failover:
                    break

                # 手动模式：不自动切换
                if manual_model:
                    break

                continue

        # 记录 Trace
        self._build_trace(
            task_name=task_name,
            user_prompt=user_prompt,
            content=content,
            usage=usage,
            start_time=start_time,
            used_model=used_model,
            used_label=used_label,
            failover_log=failover_log,
            status="success" if content else "failed",
            error=last_error,
            failover_details=failover_details,
            local_lock_status=local_lock_status,
            mode=mode,
        )

        if content:
            return content

        chain_desc = " -> ".join(m["display_name"] for m in attempt_chain)
        return f"[AI调用失败] 所有模型均不可用或被拦截\n最后错误: {last_error}\n\n尝试链: {chain_desc}"

    # ============ 视觉理解 ============
    def chat_with_image(self, image_data_url, user_prompt, task_name=None, manual_model=None):
        """
        多模态图片理解。
        只有视觉能力的模型才能接收图片；非视觉模型会被跳过。
        Args:
            manual_model: 手动选择视觉模型ID
        """
        if not self.is_configured():
            return self._demo_response(user_prompt)

        if not image_data_url:
            return "[错误] 未提供图片输入。"

        start_time = time.time()
        failover_log = []
        failover_details = []
        content = None
        used_label = None
        last_error = None
        mode = "manual" if manual_model else "auto"
        local_lock_status = None

        # 构建视觉链
        if manual_model is None:
            manual_model = self.manual_vision_model
        if manual_model:
            registry = build_model_registry()
            if manual_model in registry and registry[manual_model].get("vision_capable"):
                attempt_chain = [registry[manual_model]]
            else:
                return f"[错误] 手动选择的模型 '{manual_model}' 不支持视觉或不在注册表中。"
        else:
            attempt_chain = get_vision_chain()

        # 过滤：只保留视觉能力模型
        attempt_chain = [m for m in attempt_chain if m.get("vision_capable", False)]

        for idx, model_info in enumerate(attempt_chain):
            model_id = model_info["id"]
            label = model_info["display_name"]
            mtype = model_info["type"]

            if not health.is_available(model_id):
                st = health.get_status(model_id)
                failover_log.append(f"{label} 跳过({st.get('status_label','不可用')})")
                continue

            # 构建消息（在线用 OpenAI 格式，本地用 Ollama 格式）
            if mtype == "online":
                messages = [
                    {"role": "user", "content": [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": image_data_url}},
                    ]}
                ]
            else:
                # Ollama 原生格式：图片用 base64 数组
                # 从 data URL 提取 base64
                img_b64 = image_data_url
                if "," in image_data_url:
                    img_b64 = image_data_url.split(",", 1)[1]
                messages = [
                    {"role": "user", "content": user_prompt, "images": [img_b64]}
                ]

            req_start = time.time()
            try:
                if mtype == "local":
                    lock_acquired = local_model_manager.acquire(model_info["api_model"], timeout=300)
                    if not lock_acquired:
                        failover_log.append(f"{label} 锁等待超时")
                        continue
                    local_lock_status = "acquired"
                    try:
                        resp = self._call_local_chat(model_info, messages, temperature=0.3)
                        req_elapsed = time.time() - req_start
                        if resp.status_code != 200:
                            raise Exception(f"HTTP {resp.status_code}: {resp.text[:120]}")
                        content, _ = self._parse_local_chat_response(resp)
                    finally:
                        local_model_manager.release(model_info["api_model"])
                        local_lock_status = "released"
                else:
                    resp = self._call_online_chat(model_info, messages, temperature=0.3, max_tokens=2000)
                    req_elapsed = time.time() - req_start
                    if resp.status_code != 200:
                        raise Exception(f"HTTP {resp.status_code}: {resp.text[:120]}")
                    data = resp.json()
                    content = data["choices"][0]["message"].get("content", "")

                if content and len(content.strip()) >= 2:
                    used_label = label
                    health.set_status(model_id, HEALTH_AVAILABLE, elapsed=req_elapsed)
                    if idx > 0:
                        failover_log.append(f"视觉故障转移: {attempt_chain[0]['display_name']} -> {label}")
                    break
                else:
                    raise Exception("模型返回空内容")

            except Exception as e:
                req_elapsed = time.time() - req_start
                status_code = None
                if "HTTP " in str(e):
                    try:
                        status_code = int(str(e).split("HTTP ")[1].split(":")[0])
                    except (ValueError, IndexError):
                        pass
                can_failover, error_type, error_msg = _classify_error(e, status_code)
                last_error = f"{label}: {error_msg}"

                if status_code == 429:
                    health.set_status(model_id, HEALTH_RATE_LIMITED, elapsed=req_elapsed, error=error_msg)
                elif error_type == "timeout":
                    health.set_status(model_id, HEALTH_TIMEOUT, elapsed=req_elapsed, error=error_msg)
                elif can_failover:
                    health.set_status(model_id, HEALTH_UNAVAILABLE, elapsed=req_elapsed, error=error_msg)

                if idx < len(attempt_chain) - 1 and can_failover and not manual_model:
                    next_label = attempt_chain[idx + 1]["display_name"]
                    failover_log.append(f"{label} 失败({error_msg}) -> {next_label}")
                    failover_details.append({
                        "from": label, "to": next_label, "type": mtype,
                        "status_code": status_code, "reason": error_msg,
                        "elapsed": round(req_elapsed, 2),
                        "time": datetime.now().strftime("%H:%M:%S"), "mode": mode,
                    })
                else:
                    failover_log.append(f"{label} 失败({error_msg})")

                if not can_failover or manual_model:
                    break
                continue

        self._build_trace(
            task_name=task_name or "图片理解",
            user_prompt=user_prompt,
            content=content,
            usage={},
            start_time=start_time,
            used_model=model_info["api_model"] if content else None,
            used_label=used_label,
            failover_log=failover_log,
            status="success" if content else "failed",
            error=last_error,
            failover_details=failover_details,
            local_lock_status=local_lock_status,
            mode=mode,
        )

        if content:
            return content
        return f"[图片理解失败] 所有视觉模型均不可用\n最后错误: {last_error}"

    # ============ 图像生成 ============
    def generate_image(self, prompt, model="cogview-3-flash", size="1024x1024",
                       task_name=None, manual_model=None):
        """
        图像生成（支持 CogView 云端 + FLUX 本地故障转移）。
        Args:
            manual_model: 'auto' / 'cogview-3-flash' / 'x/flux2-klein:4b-fp4'
        Returns:
            dict: {"success": bool, "url": str, "error": str, "model": str, "local_path": str}
        """
        if not self.is_configured():
            return {"success": False, "url": None, "error": "未配置API Key", "model": None}

        start_time = time.time()
        failover_log = []
        mode = "manual" if manual_model and manual_model != "auto" else "auto"
        local_lock_status = None

        # 构建图像生成链
        if manual_model and manual_model != "auto":
            registry = build_model_registry()
            if manual_model in registry and registry[manual_model]["category"] == "image":
                attempt_chain = [registry[manual_model]]
            else:
                return {"success": False, "url": None, "error": f"手动选择的图像模型 '{manual_model}' 无效", "model": None}
        else:
            attempt_chain = get_image_chain()

        for idx, model_info in enumerate(attempt_chain):
            label = model_info["display_name"]
            mtype = model_info["type"]
            model_id = model_info["id"]

            if not health.is_available(model_id):
                st = health.get_status(model_id)
                failover_log.append(f"{label} 跳过({st.get('status_label','不可用')})")
                continue

            req_start = time.time()
            try:
                if mtype == "local":
                    # FLUX 本地生成
                    lock_acquired = local_model_manager.acquire(model_info["api_model"], timeout=300)
                    if not lock_acquired:
                        failover_log.append(f"{label} 锁等待超时")
                        continue
                    local_lock_status = "acquired"
                    try:
                        result = self._call_local_image(model_info, prompt)
                        req_elapsed = time.time() - req_start
                    finally:
                        local_model_manager.release(model_info["api_model"])
                        local_lock_status = "released"

                    if not result["success"]:
                        raise Exception(result["error"])

                    # 保存 base64 图片为临时文件
                    img_b64 = result["image_b64"]
                    img_bytes = base64.b64decode(img_b64)
                    tmp_dir = Path(__file__).parent / "data" / "generated_images"
                    tmp_dir.mkdir(parents=True, exist_ok=True)
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    img_path = tmp_dir / f"flux_{timestamp}_{idx}.png"
                    img_path.write_bytes(img_bytes)

                    health.set_status(model_id, HEALTH_AVAILABLE, elapsed=req_elapsed)
                    if idx > 0:
                        failover_log.append(f"图像故障转移: CogView -> {label}")

                    self._build_trace(
                        task_name=task_name or "图像生成",
                        user_prompt=prompt,
                        content=f"[图像生成] {label}",
                        usage={},
                        start_time=start_time,
                        used_model=model_info["api_model"],
                        used_label=label,
                        failover_log=failover_log,
                        status="success",
                        error=None,
                        failover_details=[],
                        local_lock_status=local_lock_status,
                        mode=mode,
                    )
                    return {
                        "success": True,
                        "url": None,
                        "local_path": str(img_path),
                        "error": None,
                        "model": label,
                    }
                else:
                    # CogView 云端
                    resp = requests.post(
                        f"{model_info['base_url'].rstrip('/')}/images/generations",
                        headers={
                            "Authorization": f"Bearer {model_info['api_key']}",
                            "Content-Type": "application/json",
                        },
                        json={"model": model_info["api_model"], "prompt": prompt, "size": size},
                        timeout=120,
                    )
                    req_elapsed = time.time() - req_start
                    if resp.status_code != 200:
                        raise Exception(f"HTTP {resp.status_code}: {resp.text[:120]}")
                    data = resp.json()
                    img_url = data["data"][0]["url"]

                    # 验证返回有效图片URL
                    if not img_url or not isinstance(img_url, str) or len(img_url) < 10:
                        raise Exception("CogView返回无效图片结果")

                    health.set_status(model_id, HEALTH_AVAILABLE, elapsed=req_elapsed)

                    self._build_trace(
                        task_name=task_name or "图像生成",
                        user_prompt=prompt,
                        content=f"[图像生成] {label}",
                        usage={},
                        start_time=start_time,
                        used_model=model_info["api_model"],
                        used_label=label,
                        failover_log=failover_log,
                        status="success",
                        error=None,
                        failover_details=[],
                        local_lock_status=None,
                        mode=mode,
                    )
                    return {"success": True, "url": img_url, "local_path": None, "error": None, "model": label}

            except Exception as e:
                req_elapsed = time.time() - req_start
                status_code = None
                if "HTTP " in str(e):
                    try:
                        status_code = int(str(e).split("HTTP ")[1].split(":")[0])
                    except (ValueError, IndexError):
                        pass
                can_failover, error_type, error_msg = _classify_error(e, status_code)

                if status_code == 429:
                    health.set_status(model_id, HEALTH_RATE_LIMITED, elapsed=req_elapsed, error=error_msg)
                elif error_type == "timeout":
                    health.set_status(model_id, HEALTH_TIMEOUT, elapsed=req_elapsed, error=error_msg)
                elif can_failover:
                    health.set_status(model_id, HEALTH_UNAVAILABLE, elapsed=req_elapsed, error=error_msg)

                if idx < len(attempt_chain) - 1 and can_failover and not manual_model:
                    next_label = attempt_chain[idx + 1]["display_name"]
                    failover_log.append(f"{label} 失败({error_msg}) -> {next_label}")
                else:
                    failover_log.append(f"{label} 失败({error_msg})")

                if not can_failover or (manual_model and manual_model != "auto"):
                    break
                continue

        elapsed = time.time() - start_time
        self._build_trace(
            task_name=task_name or "图像生成",
            user_prompt=prompt,
            content=None,
            usage={},
            start_time=start_time,
            used_model=None,
            used_label=None,
            failover_log=failover_log,
            status="failed",
            error="所有图像生成模型均不可用",
            failover_details=[],
            local_lock_status=local_lock_status,
            mode=mode,
        )
        return {"success": False, "url": None, "local_path": None, "error": "所有图像生成模型均不可用", "model": None}

    def get_recent_traces(self, limit=20):
        try:
            trace_file = TRACE_DIR / f"trace_{datetime.now().strftime('%Y%m')}.json"
            if trace_file.exists():
                data = json.loads(trace_file.read_text(encoding="utf-8"))
                return list(reversed(data[-limit:]))
        except Exception:
            pass
        return []

    def _demo_response(self, prompt):
        return f"""[演示模式 - 未配置API Key]

你输入的内容已收到。要启用真实AI功能，请：
1. 配置API Key（左侧模型管理）
2. 重启工作台

当前请求摘要：
- 内容长度：{len(prompt)} 字符
- 前100字：{prompt[:100]}...

以下为示例输出格式（非真实AI生成）：

---
这是一个示例回复。配置API Key后，这里将显示真实的AI生成内容。
---"""


# 全局单例
ai = AIClient()
