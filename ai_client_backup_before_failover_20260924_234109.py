# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI客户开发工作台 - AI调用模块 v3.0
支持15+主流大模型提供商（统一OpenAI兼容接口）
优化：长超时、重试机制、推理模型支持、多提供商切换
新增：Trace追溯（每次调用记录模型/耗时/token/来源）
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

# Trace存储目录
TRACE_DIR = Path(__file__).parent / "data" / "trace"
TRACE_DIR.mkdir(parents=True, exist_ok=True)


class AIClient:
    """AI客户端 - 统一接口，支持15+模型提供商 + Trace追溯"""

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
        self.last_trace = None  # 最近一次调用的trace

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

    def test_connection(self, provider=None, api_key=None, base_url=None, model=None):
        test_provider = provider or self.provider
        test_key = api_key or self.api_key
        test_url = base_url or self.base_url
        test_model = model or self.model
        if not test_key:
            return False, "API Key为空"
        try:
            resp = requests.post(
                f"{test_url}/chat/completions",
                headers={"Authorization": f"Bearer {test_key}", "Content-Type": "application/json"},
                json={"model": test_model, "messages": [{"role": "user", "content": "你好，请回复'连接成功'"}], "max_tokens": 50},
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
        """保存trace到JSON文件"""
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
        """
        调用AI对话接口（带Trace）
        Args:
            task_name: 任务名称（如"询盘回复"、"开发信生成"）
            knowledge_refs: 本次调用引用的知识库来源列表
        Returns:
            str: AI回复内容
        """
        if not self.is_configured():
            return self._demo_response(user_prompt)

        model = self.model_lite if use_lite else self.model
        messages = [
            {"role": "system", "content": system_prompt or SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        start_time = time.time()
        last_error = None
        content = None
        usage = {}

        for attempt in range(max_retries + 1):
            try:
                resp = requests.post(
                    f"{self.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    json={"model": model, "messages": messages, "temperature": temperature, "max_tokens": 4000},
                    timeout=self.timeout,
                )
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                usage = data.get("usage", {})
                if not content or len(content.strip()) < 2:
                    reasoning = data["choices"][0]["message"].get("reasoning_content", "")
                    if reasoning:
                        content = f"[推理过程已省略]\n\n{content or '（模型未返回最终答案）'}"
                break
            except requests.exceptions.Timeout:
                last_error = "请求超时"
                if attempt < max_retries:
                    time.sleep(2)
                    continue
            except Exception as e:
                last_error = str(e)
                if attempt < max_retries:
                    time.sleep(2)
                    continue

        elapsed = time.time() - start_time

        # 记录Trace
        trace = {
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "task": task_name or "未命名任务",
            "model": model,
            "provider": self.get_provider_name(),
            "elapsed_seconds": round(elapsed, 2),
            "prompt_chars": len(user_prompt),
            "completion_chars": len(content) if content else 0,
            "prompt_tokens": usage.get("prompt_tokens", "N/A"),
            "completion_tokens": usage.get("completion_tokens", "N/A"),
            "total_tokens": usage.get("total_tokens", "N/A"),
            "knowledge_refs": knowledge_refs or [],
            "status": "success" if content else "failed",
            "error": last_error,
        }
        self.last_trace = trace
        self._save_trace(trace)

        if content:
            return content
        return f"[AI调用失败: {last_error}]\n\n提示：推理模型响应较慢，请稍后重试。"

    def get_recent_traces(self, limit=20):
        """获取最近的Trace记录"""
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
