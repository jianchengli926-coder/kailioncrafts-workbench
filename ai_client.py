# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - AI调用模块 v4.0
支持15+主流大模型提供商（统一OpenAI兼容接口）
v4.0 新增：模型故障转移（在线优先，本地兜底），当前模型不可用时自动切换备用模型
优化：长超时、推理模型支持、多提供商切换
新增：Trace追溯（每次调用记录模型/耗时/token/来源/故障转移）
"""
import json
import time
import requests
from pathlib import Path
from datetime import datetime
from config import (
    AI_PROVIDER, DOUBAO_API_KEY, DOUBAO_BASE_URL, DOUBAO_MODEL, DOUBAO_MODEL_LITE,
    OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_MODEL_LITE,
    ALL_PROVIDERS,
)
from prompts import SYSTEM_PROMPT

TRACE_DIR = Path(__file__).parent / "data" / "trace"
TRACE_DIR.mkdir(parents=True, exist_ok=True)


class AIClient:
    """AI客户端 - 统一接口，支持多模型 + 故障转移 + Trace追溯"""

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
        self.timeout = 180
        self.last_trace = None
        self.failover_chain = self._build_failover_chain()

    def _build_failover_chain(self):
        chain = []
        seen = set()

        def add_endpoint(base_url, api_key, model, label, etype="online"):
            if not base_url or not api_key or not model:
                return
            key = f"{base_url.rstrip('/')}|{model}"
            if key in seen:
                return
            seen.add(key)
            chain.append({
                "base_url": base_url.rstrip("/"),
                "api_key": api_key,
                "model": model,
                "label": label,
                "type": etype,
            })

        provider_name = ALL_PROVIDERS.get(self.provider, {}).get("name", self.provider)
        add_endpoint(self.base_url, self.api_key, self.model,
                     f"{provider_name}/{self.model}", "online")

        if self.model_lite and self.model_lite != self.model:
            add_endpoint(self.base_url, self.api_key, self.model_lite,
                         f"{provider_name}/{self.model_lite}", "online")

        try:
            from provider_manager import load_providers
            data = load_providers()
            active_id = data.get("active_provider", "")
            online_list = []
            local_list = []
            for p in data["providers"]:
                if p["id"] == active_id:
                    continue
                if not p.get("api_key") or not p.get("base_url"):
                    continue
                models = p.get("models", [])
                if not models:
                    continue
                first_model = models[0]
                if p.get("type") == "local":
                    # 本地模型：所有模型都加入故障转移链（兜底用，多模型更可靠）
                    for m in models:
                        local_list.append((p, m))
                else:
                    online_list.append((p, first_model))
            for p, m in online_list:
                add_endpoint(p["base_url"], p["api_key"], m,
                             f"{p['name']}/{m}", "online")
            for p, m in local_list:
                add_endpoint(p["base_url"], p["api_key"], m,
                             f"{p['name']}/{m}", "local")
        except Exception:
            pass

        return chain

    def get_failover_chain(self):
        return self.failover_chain

    def refresh_failover_chain(self):
        self.failover_chain = self._build_failover_chain()
        return self.failover_chain

    def get_provider_name(self):
        return ALL_PROVIDERS.get(self.provider, {}).get("name", self.provider)

    def is_configured(self):
        return bool(self.api_key)

    def update_config(self, provider=None, api_key=None, base_url=None, model=None, model_lite=None):
        if provider: self.provider = provider
        if api_key: self.api_key = api_key
        if base_url: self.base_url = base_url
        if model: self.model = model
        if model_lite: self.model_lite = model_lite
        self.refresh_failover_chain()

    def test_connection(self, provider=None, api_key=None, base_url=None, model=None):
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

    def chat(self, user_prompt, system_prompt=None, use_lite=False, temperature=0.7,
             max_retries=2, task_name=None, knowledge_refs=None):
        if not self.is_configured():
            return self._demo_response(user_prompt)

        messages = [
            {"role": "system", "content": system_prompt or SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        start_time = time.time()
        last_error = None
        content = None
        usage = {}
        failover_log = []
        used_model = None
        used_label = None

        if use_lite and self.model_lite and self.model_lite != self.model:
            attempt_chain = []
            seen = set()
            attempt_chain.append({
                "base_url": self.base_url.rstrip("/"), "api_key": self.api_key,
                "model": self.model_lite, "label": f"{self.get_provider_name()}/{self.model_lite}", "type": "online"
            })
            seen.add(f"{self.base_url.rstrip('/')}|{self.model_lite}")
            attempt_chain.append({
                "base_url": self.base_url.rstrip("/"), "api_key": self.api_key,
                "model": self.model, "label": f"{self.get_provider_name()}/{self.model}", "type": "online"
            })
            seen.add(f"{self.base_url.rstrip('/')}|{self.model}")
            for ep in self.failover_chain:
                key = f"{ep['base_url']}|{ep['model']}"
                if key not in seen:
                    attempt_chain.append(ep)
                    seen.add(key)
        else:
            attempt_chain = list(self.failover_chain)

        for idx, endpoint in enumerate(attempt_chain):
            model = endpoint["model"]
            label = endpoint["label"]
            try:
                resp = requests.post(
                    f"{endpoint['base_url']}/chat/completions",
                    headers={"Authorization": f"Bearer {endpoint['api_key']}", "Content-Type": "application/json"},
                    json={"model": model, "messages": messages, "temperature": temperature, "max_tokens": 4000},
                    timeout=self.timeout,
                )
                if resp.status_code != 200:
                    raise Exception(f"HTTP {resp.status_code}: {resp.text[:120]}")
                data = resp.json()
                msg = data["choices"][0]["message"]
                content = msg.get("content", "")
                usage = data.get("usage", {})

                if (not content or len(content.strip()) < 2) and msg.get("reasoning_content"):
                    content = f"[推理模型响应]\n\n{content or '（模型推理较长，请重试获取完整答案）'}"

                if content and len(content.strip()) >= 2:
                    used_model = model
                    used_label = label
                    if idx > 0:
                        failover_log.append(f"故障转移: {attempt_chain[0]['label']} -> {label}")
                    break
                else:
                    raise Exception("模型返回空内容")

            except requests.exceptions.Timeout:
                last_error = f"{label} 请求超时"
                failover_log.append(f"{label} 超时")
                continue
            except Exception as e:
                last_error = f"{label}: {str(e)[:80]}"
                failover_log.append(f"{label} 失败: {str(e)[:60]}")
                continue

        elapsed = time.time() - start_time

        trace = {
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "task": task_name or "未命名任务",
            "model": used_model or self.model,
            "provider": used_label or self.get_provider_name(),
            "elapsed_seconds": round(elapsed, 2),
            "prompt_chars": len(user_prompt),
            "completion_chars": len(content) if content else 0,
            "prompt_tokens": usage.get("prompt_tokens", "N/A"),
            "completion_tokens": usage.get("completion_tokens", "N/A"),
            "total_tokens": usage.get("total_tokens", "N/A"),
            "knowledge_refs": knowledge_refs or [],
            "status": "success" if content else "failed",
            "error": last_error,
            "failover": failover_log if failover_log else None,
            "failover_count": len(failover_log),
        }
        self.last_trace = trace
        self._save_trace(trace)

        if content:
            return content

        chain_desc = " -> ".join(e["label"] for e in attempt_chain)
        return f"[AI调用失败] 所有 {len(attempt_chain)} 个模型均不可用\n最后错误: {last_error}\n\n故障转移链: {chain_desc}"

    def get_recent_traces(self, limit=20):
        try:
            trace_file = TRACE_DIR / f"trace_{datetime.now().strftime('%Y%m')}.json"
            if trace_file.exists():
                data = json.loads(trace_file.read_text(encoding="utf-8"))
                return list(reversed(data[-limit:]))
        except Exception:
            pass
        return []

    def generate_image(self, prompt, model="cogview-3-flash", size="1024x1024", task_name=None):
        """
        图像生成（支持故障转移）
        Args:
            prompt: 图像描述提示词
            model: 图像生成模型，默认 cogview-3-flash
            size: 图片尺寸，默认 1024x1024
            task_name: 任务名称
        Returns:
            dict: {"success": bool, "url": str, "error": str, "model": str}
        """
        if not self.is_configured():
            return {"success": False, "url": None, "error": "未配置API Key", "model": None}

        # 构建图像生成故障转移链：优先用智谱的cogview，备用硅基流动的图像模型
        image_endpoints = []
        seen = set()

        # 从故障转移链中筛选可能支持图像生成的端点
        for ep in self.failover_chain:
            key = f"{ep['base_url']}|{ep['model']}"
            if key in seen:
                continue
            seen.add(key)
            # 智谱平台支持 cogview-3-flash
            if 'bigmodel.cn' in ep['base_url']:
                image_endpoints.append({
                    "base_url": ep['base_url'],
                    "api_key": ep['api_key'],
                    "model": "cogview-3-flash",
                    "label": f"{ep['label']}/cogview-3-flash",
                })

        # 如果故障转移链里没有智谱，用当前配置
        if not image_endpoints and self.api_key:
            image_endpoints.append({
                "base_url": self.base_url,
                "api_key": self.api_key,
                "model": model,
                "label": f"{self.get_provider_name()}/{model}",
            })

        start_time = time.time()
        for idx, endpoint in enumerate(image_endpoints):
            try:
                resp = requests.post(
                    f"{endpoint['base_url']}/images/generations",
                    headers={"Authorization": f"Bearer {endpoint['api_key']}", "Content-Type": "application/json"},
                    json={"model": endpoint['model'], "prompt": prompt, "size": size},
                    timeout=120,
                )
                if resp.status_code != 200:
                    raise Exception(f"HTTP {resp.status_code}: {resp.text[:120]}")
                data = resp.json()
                img_url = data["data"][0]["url"]
                elapsed = time.time() - start_time

                trace = {
                    "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "task": task_name or "图像生成",
                    "model": endpoint['model'],
                    "provider": endpoint['label'],
                    "elapsed_seconds": round(elapsed, 2),
                    "prompt_chars": len(prompt),
                    "completion_chars": 0,
                    "prompt_tokens": "N/A",
                    "completion_tokens": "N/A",
                    "total_tokens": "N/A",
                    "knowledge_refs": [],
                    "status": "success",
                    "error": None,
                    "failover": None,
                    "failover_count": idx,
                    "image_url": img_url,
                }
                self.last_trace = trace
                self._save_trace(trace)
                return {"success": True, "url": img_url, "error": None, "model": endpoint['model']}
            except Exception as e:
                continue

        elapsed = time.time() - start_time
        trace = {
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "task": task_name or "图像生成",
            "model": model,
            "provider": self.get_provider_name(),
            "elapsed_seconds": round(elapsed, 2),
            "prompt_chars": len(prompt),
            "completion_chars": 0,
            "prompt_tokens": "N/A",
            "completion_tokens": "N/A",
            "total_tokens": "N/A",
            "knowledge_refs": [],
            "status": "failed",
            "error": "所有图像生成模型均不可用",
            "failover": None,
            "failover_count": len(image_endpoints),
            "image_url": None,
        }
        self.last_trace = trace
        self._save_trace(trace)
        return {"success": False, "url": None, "error": "所有图像生成模型均不可用", "model": None}

    def chat_with_image(self, image_data_url, user_prompt, task_name=None):
        """
        多模态图片理解（glm-4.6v-flash，支持故障转移）
        Args:
            image_data_url: 图片的base64 data URL（如 data:image/png;base64,...）
            user_prompt: 对图片的提问/指令
            task_name: 任务名称
        Returns:
            str: AI对图片的分析结果
        """
        if not self.is_configured():
            return self._demo_response(user_prompt)

        vision_endpoints = []
        seen = set()
        for ep in self.failover_chain:
            key = f"{ep['base_url']}|{ep['model']}"
            if key in seen:
                continue
            seen.add(key)
            if 'bigmodel.cn' in ep['base_url']:
                vision_endpoints.append({
                    "base_url": ep['base_url'],
                    "api_key": ep['api_key'],
                    "model": "glm-4.6v-flash",
                    "label": f"{ep['label']}/glm-4.6v-flash",
                })

        if not vision_endpoints and self.api_key:
            vision_endpoints.append({
                "base_url": self.base_url,
                "api_key": self.api_key,
                "model": "glm-4.6v-flash",
                "label": f"{self.get_provider_name()}/glm-4.6v-flash",
            })

        messages = [
            {"role": "user", "content": [
                {"type": "text", "text": user_prompt},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ]}
        ]

        start_time = time.time()
        last_error = None
        content = None
        used_label = None

        for idx, endpoint in enumerate(vision_endpoints):
            try:
                resp = requests.post(
                    f"{endpoint['base_url']}/chat/completions",
                    headers={"Authorization": f"Bearer {endpoint['api_key']}", "Content-Type": "application/json"},
                    json={"model": endpoint['model'], "messages": messages, "temperature": 0.3, "max_tokens": 2000},
                    timeout=self.timeout,
                )
                if resp.status_code != 200:
                    raise Exception(f"HTTP {resp.status_code}: {resp.text[:120]}")
                data = resp.json()
                content = data["choices"][0]["message"].get("content", "")
                if content and len(content.strip()) >= 2:
                    used_label = endpoint['label']
                    break
                else:
                    raise Exception("模型返回空内容")
            except Exception as e:
                last_error = f"{endpoint['label']}: {str(e)[:80]}"
                continue

        elapsed = time.time() - start_time
        trace = {
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "task": task_name or "图片理解",
            "model": "glm-4.6v-flash",
            "provider": used_label or "视觉模型",
            "elapsed_seconds": round(elapsed, 2),
            "prompt_chars": len(user_prompt),
            "completion_chars": len(content) if content else 0,
            "prompt_tokens": "N/A",
            "completion_tokens": "N/A",
            "total_tokens": "N/A",
            "knowledge_refs": [],
            "status": "success" if content else "failed",
            "error": last_error,
            "failover": None,
            "failover_count": idx if content else len(vision_endpoints),
            "image_analysis": True,
        }
        self.last_trace = trace
        self._save_trace(trace)

        if content:
            return content
        return f"[图片理解失败] 所有视觉模型均不可用\n最后错误: {last_error}"

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


ai = AIClient()
