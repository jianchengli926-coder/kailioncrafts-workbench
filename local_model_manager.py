# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI工作台 - 本地模型互斥锁管理器 v1.0
Apple M4 / 16GB 统一内存，同一时刻最多只允许一个本地大模型加载运行。
全局互斥锁 + Ollama keep_alive:0 卸载 + 加载状态验证。
"""
import time
import threading
import requests
from datetime import datetime

OLLAMA_BASE = "http://localhost:11434"
OLLAMA_UNLOAD_TIMEOUT = 30
OLLAMA_LOAD_CHECK_INTERVAL = 1.0
OLLAMA_LOAD_CHECK_MAX_RETRIES = 30


class LocalModelManager:
    """
    全局本地模型互斥锁管理器（单例）。
    所有本地大模型（qwen3.5:9b, deepseek-r1:7b, qwen2.5:7b, qwen2.5vl:7b, FLUX）
    共用同一把锁，确保同一时刻只有一个模型加载。
    """
    _instance = None
    _singleton_lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._singleton_lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        # 全局互斥锁：所有本地模型共用
        self._global_lock = threading.Lock()
        # 当前活跃模型（None 表示无模型加载）
        self._active_model = None
        self._active_since = None
        self._lock_holder = None  # 持有锁的线程标识
        # 任务队列计数
        self._waiting_count = 0
        self._total_tasks = 0
        self._lock = threading.Lock()  # 保护自身状态的锁

    # ============ 锁获取/释放 ============
    def acquire(self, model_id, timeout=300):
        """
        获取全局本地模型锁。如果当前有不同模型在运行，等待其完成并卸载。
        Args:
            model_id: 目标模型 Ollama ID
            timeout: 最大等待秒数
        Returns:
            bool: 是否成功获取锁
        """
        thread_id = threading.current_thread().name
        with self._lock:
            self._waiting_count += 1

        acquired = self._global_lock.acquire(timeout=timeout)
        if not acquired:
            with self._lock:
                self._waiting_count -= 1
            return False

        with self._lock:
            self._waiting_count -= 1
            self._lock_holder = thread_id
            self._total_tasks += 1

        # 检查当前活跃模型
        current = self._get_running_model()
        if current and current != model_id:
            # 有不同模型在运行，先卸载
            self._unload_model(current)
            # 验证已卸载
            if not self._wait_until_unloaded(current):
                # 卸载失败但仍继续，强制标记
                pass

        self._active_model = model_id
        self._active_since = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return True

    def release(self, model_id):
        """
        释放锁：先卸载模型，验证已退出，再释放全局锁。
        Args:
            model_id: 当前使用的模型 Ollama ID
        """
        try:
            # 主动卸载模型
            self._unload_model(model_id)
            # 验证已从运行状态退出
            self._wait_until_unloaded(model_id, max_wait=15)
        finally:
            with self._lock:
                self._active_model = None
                self._active_since = None
                self._lock_holder = None
            self._global_lock.release()

    # ============ Ollama 模型状态查询 ============
    def _get_running_models(self):
        """获取当前 Ollama 中正在运行的模型列表（ollama ps）"""
        try:
            resp = requests.get(f"{OLLAMA_BASE}/api/ps", timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                return [m.get("name", "") for m in data.get("models", [])]
        except Exception:
            pass
        return []

    def _get_running_model(self):
        """获取当前运行的大模型（排除 embedding 模型）"""
        models = self._get_running_models()
        for m in models:
            if "embed" not in m.lower():
                return m
        return None

    def is_model_loaded(self, model_id):
        """检查指定模型是否已加载运行"""
        running = self._get_running_models()
        # 匹配模型名（可能带 :latest 后缀）
        for m in running:
            if m == model_id or m.startswith(model_id.split(":")[0]):
                return True
        return False

    def is_any_large_model_loaded(self):
        """是否有任何大模型正在运行（排除 embedding）"""
        return self._get_running_model() is not None

    # ============ Ollama 卸载 ============
    def _unload_model(self, model_id):
        """
        使用 Ollama 官方 keep_alive: 0 方式卸载模型。
        发送一个空请求并设置 keep_alive=0，Ollama 会立即卸载该模型。
        """
        try:
            # 使用 /api/generate 端点，keep_alive=0 表示请求后立即卸载
            resp = requests.post(
                f"{OLLAMA_BASE}/api/generate",
                json={
                    "model": model_id,
                    "prompt": "",
                    "keep_alive": 0,
                    "stream": False,
                },
                timeout=OLLAMA_UNLOAD_TIMEOUT,
            )
            return resp.status_code == 200
        except Exception:
            return False

    def _wait_until_unloaded(self, model_id, max_wait=20):
        """
        轮询验证模型已从运行状态退出。
        Returns:
            bool: 是否确认已卸载
        """
        for _ in range(max_wait):
            if not self.is_model_loaded(model_id):
                return True
            time.sleep(OLLAMA_LOAD_CHECK_INTERVAL)
        return not self.is_model_loaded(model_id)

    def wait_until_loaded(self, model_id, max_wait=30):
        """
        等待目标模型加载完成（发送请求后 Ollama 会自动加载）。
        在发送正式请求前调用，确认模型已就绪。
        Returns:
            bool: 是否确认已加载
        """
        for _ in range(max_wait):
            if self.is_model_loaded(model_id):
                return True
            time.sleep(OLLAMA_LOAD_CHECK_INTERVAL)
        return self.is_model_loaded(model_id)

    # ============ 状态查询 ============
    def get_status(self):
        """获取本地模型管理器状态"""
        with self._lock:
            return {
                "active_model": self._active_model,
                "active_since": self._active_since,
                "lock_holder": self._lock_holder,
                "waiting_count": self._waiting_count,
                "total_tasks": self._total_tasks,
                "lock_held": self._global_lock.locked(),
                "running_models": self._get_running_models(),
                "any_large_loaded": self.is_any_large_model_loaded(),
            }

    def force_unload_all(self):
        """强制卸载所有大模型（紧急清理用）"""
        running = self._get_running_models()
        for m in running:
            if "embed" not in m.lower():
                self._unload_model(m)
        with self._lock:
            self._active_model = None
            self._active_since = None


# 全局单例
local_model_manager = LocalModelManager()
