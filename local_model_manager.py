# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI工作台 - 本地模型互斥锁管理器 v2.0
Apple M4 / 16GB 统一内存，同一时刻最多只允许一个本地大模型加载运行。

完整流程：
1. 获取全局本地模型锁
2. 检查 ollama ps 是否有其他大模型运行
3. 如果有其他模型，先使用 keep_alive: 0 卸载
4. 轮询 ollama ps，确认旧模型确实退出
5. 使用 Ollama 预加载方式加载目标模型（发送极简请求触发加载）
6. 轮询确认目标模型已出现在 ollama ps
7. 只有确认目标模型已经加载后，才返回 True（调用方才发送正式请求）
8. 正式任务结束后 release() 再次使用 keep_alive: 0 卸载
9. 再次确认 ollama ps 中已经没有该大模型
10. 如果卸载失败，记录错误并返回失败状态，调用方不得继续加载下一个模型

所有以下模型共用同一个锁：
- qwen3.5:9b
- deepseek-r1:7b
- qwen2.5:7b
- qwen2.5vl:7b
- x/flux2-klein:4b-fp4
"""
import time
import threading
import requests
from datetime import datetime

OLLAMA_BASE = "http://localhost:11434"
OLLAMA_UNLOAD_TIMEOUT = 30
OLLAMA_POLL_INTERVAL = 1.0
OLLAMA_UNLOAD_MAX_WAIT = 30       # 旧模型卸载最大等待秒数
OLLAMA_LOAD_MAX_WAIT = 90         # 目标模型加载最大等待秒数（大模型冷启动可能较慢）
OLLAMA_RELEASE_MAX_WAIT = 20      # release 时卸载最大等待秒数
OLLAMA_EXTERNAL_WAIT_MAX = 120    # 等待外部模型释放的最大秒数

# FLUX 图像生成模型 ID（用于区分预加载方式）
FLUX_MODEL_IDS = {"x/flux2-klein:4b-fp4", "flux", "flux2-klein", "flux-dev", "flux-schnell"}


class LocalModelManager:
    """
    全局本地模型互斥锁管理器（单例）。
    所有本地大模型共用同一把锁，确保同一时刻只有一个模型加载。
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
        self._lock_holder = None
        # 任务队列计数
        self._waiting_count = 0
        self._total_tasks = 0
        self._lock = threading.Lock()  # 保护自身状态的锁
        # 最近一次错误（卸载失败等）
        self.last_error = None
        self._preload_ok = False  # 标记预加载是否成功确认
        # 工作台拥有的模型集合（由本 LocalModelManager acquire 加载的模型）
        # 只有 owned 模型才允许自动卸载；external 模型只能等待，不得静默卸载
        self._owned_models = set()

    # ============ 锁获取（含旧模型卸载 + 新模型预加载确认） ============
    def acquire(self, model_id, timeout=300):
        """
        获取全局本地模型锁，并完成：旧模型卸载确认 → 目标模型预加载确认。
        只有确认目标模型已出现在 ollama ps 中才返回 True。

        Args:
            model_id: 目标模型 Ollama ID（如 qwen3.5:9b）
            timeout: 最大等待锁的秒数
        Returns:
            bool: True=锁已获取且目标模型已确认加载；False=失败（检查 last_error）
        """
        self.last_error = None
        self._preload_ok = False
        thread_id = threading.current_thread().name

        with self._lock:
            self._waiting_count += 1

        # 步骤1：获取全局互斥锁
        acquired = self._global_lock.acquire(timeout=timeout)
        if not acquired:
            with self._lock:
                self._waiting_count -= 1
            self.last_error = f"获取本地模型锁超时（{timeout}s）"
            return False

        with self._lock:
            self._waiting_count -= 1
            self._lock_holder = thread_id
            self._total_tasks += 1

        try:
            # 步骤2：检查 ollama ps 是否有其他大模型运行
            current = self._get_running_large_model()
            if current and current != model_id:
                # 区分 workbench-owned 和 external model
                is_owned = self._is_owned_model(current)
                if is_owned:
                    # 工作台自己加载的模型：允许自动卸载
                    unload_ok = self._unload_model(current)
                    unload_confirmed = self._wait_until_unloaded(current, max_wait=OLLAMA_UNLOAD_MAX_WAIT)
                    if not unload_confirmed:
                        self.last_error = f"旧模型 {current} 卸载失败，无法继续加载 {model_id}"
                        with self._lock:
                            self._lock_holder = None
                        self._global_lock.release()
                        return False
                    # 卸载成功，从 owned 集合移除
                    with self._lock:
                        self._owned_models.discard(current)
                else:
                    # external model：不自动卸载，轮询等待其释放
                    wait_ok = self._wait_for_external_model_release(current, max_wait=OLLAMA_EXTERNAL_WAIT_MAX)
                    if not wait_ok:
                        self.last_error = f"本地模型 {current} 正在被其他程序使用，等待 {OLLAMA_EXTERNAL_WAIT_MAX}s 后仍未释放"
                        with self._lock:
                            self._lock_holder = None
                        self._global_lock.release()
                        return False

            # 步骤5：检查目标模型是否已加载（可能上一次未卸载干净或刚好加载）
            if self.is_model_loaded(model_id):
                self._preload_ok = True
            else:
                # 步骤5：使用 Ollama 预加载方式加载目标模型
                preload_ok = self._preload_model(model_id)
                if not preload_ok:
                    self.last_error = f"目标模型 {model_id} 预加载请求失败"
                    self._unload_model(model_id)
                    with self._lock:
                        self._lock_holder = None
                    self._global_lock.release()
                    return False

                # 步骤6：轮询确认目标模型已出现在 ollama ps
                load_confirmed = self._wait_until_loaded(model_id, max_wait=OLLAMA_LOAD_MAX_WAIT)
                if not load_confirmed:
                    self.last_error = f"目标模型 {model_id} 加载超时（{OLLAMA_LOAD_MAX_WAIT}s内未出现在ollama ps）"
                    self._unload_model(model_id)
                    with self._lock:
                        self._lock_holder = None
                    self._global_lock.release()
                    return False
                self._preload_ok = True

            # 步骤7：确认目标模型已经加载，设置活跃模型并返回
            with self._lock:
                self._active_model = model_id
                self._active_since = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                self._owned_models.add(model_id)
            return True

        except Exception as e:
            self.last_error = f"acquire 异常: {str(e)[:200]}"
            try:
                self._unload_model(model_id)
            except Exception:
                pass
            with self._lock:
                self._lock_holder = None
                self._active_model = None
            self._global_lock.release()
            return False

    # ============ 锁释放（含卸载确认） ============
    def release(self, model_id):
        """
        释放锁：先 keep_alive:0 卸载模型，轮询确认已退出，再释放全局锁。

        Args:
            model_id: 当前使用的模型 Ollama ID
        Returns:
            tuple: (success: bool, error: str or None)
                   success=True 表示模型已确认卸载；
                   success=False 表示卸载失败（检查 error），但锁仍已释放。
        """
        error = None
        try:
            # 步骤8：正式任务结束后再次使用 keep_alive: 0 卸载
            self._unload_model(model_id)
            # 步骤9：再次确认 ollama ps 中已经没有该大模型
            unload_confirmed = self._wait_until_unloaded(model_id, max_wait=OLLAMA_RELEASE_MAX_WAIT)
            if not unload_confirmed:
                error = f"模型 {model_id} 在 release 后 {OLLAMA_RELEASE_MAX_WAIT}s 内未完全卸载"
                self.last_error = error
        except Exception as e:
            error = f"release 卸载异常: {str(e)[:200]}"
            self.last_error = error
        finally:
            with self._lock:
                self._active_model = None
                self._active_since = None
                self._lock_holder = None
                self._preload_ok = False
                self._owned_models.discard(model_id)
            # 无论卸载是否成功，都释放全局锁（避免死锁）
            self._global_lock.release()

        return (error is None, error)

    # ============ Ollama 模型状态查询 ============
    def _get_running_models(self):
        """获取当前 Ollama 中正在运行的模型列表（ollama ps / GET /api/ps）"""
        try:
            resp = requests.get(f"{OLLAMA_BASE}/api/ps", timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                return [m.get("name", "") for m in data.get("models", [])]
        except Exception:
            pass
        return []

    def _get_running_large_model(self):
        """获取当前运行的大模型（排除 embedding 模型），返回第一个或 None"""
        models = self._get_running_models()
        for m in models:
            if "embed" not in m.lower():
                return m
        return None

    def _is_owned_model(self, model_id):
        """
        检查模型是否由当前工作台 LocalModelManager 拥有。
        只有 owned 模型才允许自动卸载；external 模型只能等待。
        """
        with self._lock:
            # 精确匹配或基础名匹配
            for owned in self._owned_models:
                if model_id == owned or model_id == f"{owned}:latest":
                    return True
                if "/" in owned and model_id.endswith(owned.split("/")[-1]):
                    return True
            return False

    def _wait_for_external_model_release(self, model_id, max_wait=OLLAMA_EXTERNAL_WAIT_MAX):
        """
        等待外部程序加载的模型自行释放。
        不调用 keep_alive:0 卸载，只轮询 ollama ps。
        Returns:
            bool: True=模型已释放；False=超时仍在运行
        """
        for _ in range(max_wait):
            if not self.is_model_loaded(model_id):
                return True
            time.sleep(OLLAMA_POLL_INTERVAL)
        return not self.is_model_loaded(model_id)

    def is_model_loaded(self, model_id):
        """检查指定模型是否已加载运行（通过 ollama ps）"""
        running = self._get_running_models()
        for m in running:
            # 精确匹配或基础名匹配（qwen3.5:9b == qwen3.5:9b）
            if m == model_id or m == f"{model_id}:latest":
                return True
            # 处理 x/flux2-klein:4b-fp4 这种带命名空间的
            if "/" in model_id and m.endswith(model_id.split("/")[-1]):
                return True
        return False

    def is_any_large_model_loaded(self):
        """是否有任何大模型正在运行（排除 embedding）"""
        return self._get_running_large_model() is not None

    # ============ Ollama 卸载 ============
    def _unload_model(self, model_id):
        """
        使用 Ollama 官方 keep_alive: 0 方式卸载模型。
        发送空请求并设置 keep_alive=0，Ollama 会立即卸载该模型。
        Returns:
            bool: 卸载请求是否发送成功（不代表已卸载，需轮询确认）
        """
        try:
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

    def _wait_until_unloaded(self, model_id, max_wait=OLLAMA_UNLOAD_MAX_WAIT):
        """
        轮询 ollama ps，验证模型已从运行状态退出。
        Returns:
            bool: 是否确认已卸载
        """
        for _ in range(max_wait):
            if not self.is_model_loaded(model_id):
                return True
            time.sleep(OLLAMA_POLL_INTERVAL)
        return not self.is_model_loaded(model_id)

    def _wait_until_loaded(self, model_id, max_wait=OLLAMA_LOAD_MAX_WAIT):
        """
        轮询 ollama ps，确认目标模型已出现在运行列表中。
        Returns:
            bool: 是否确认已加载
        """
        for _ in range(max_wait):
            if self.is_model_loaded(model_id):
                return True
            time.sleep(OLLAMA_POLL_INTERVAL)
        return self.is_model_loaded(model_id)

    # ============ Ollama 预加载 ============
    def _preload_model(self, model_id):
        """
        使用 Ollama 预加载方式加载目标模型。
        发送一个极简请求触发模型加载，keep_alive 设为 5 分钟保持加载状态。
        对于文本/视觉模型使用 /api/chat，对于 FLUX 图像模型使用 /api/generate。

        Returns:
            bool: 预加载请求是否发送成功（不代表已加载，需轮询确认）
        """
        is_flux = any(flux_id in model_id for flux_id in FLUX_MODEL_IDS) or "flux" in model_id.lower()

        try:
            if is_flux:
                # FLUX 图像模型：用 /api/generate 触发加载（极简prompt，结果丢弃）
                resp = requests.post(
                    f"{OLLAMA_BASE}/api/generate",
                    json={
                        "model": model_id,
                        "prompt": ".",
                        "stream": False,
                        "keep_alive": "5m",
                    },
                    timeout=OLLAMA_LOAD_MAX_WAIT,
                )
            else:
                # 文本/视觉模型：用 /api/chat 触发加载（极简消息，num_predict=1）
                resp = requests.post(
                    f"{OLLAMA_BASE}/api/chat",
                    json={
                        "model": model_id,
                        "messages": [{"role": "user", "content": "hi"}],
                        "stream": False,
                        "keep_alive": "5m",
                        "options": {"num_predict": 1},
                    },
                    timeout=OLLAMA_LOAD_MAX_WAIT,
                )
            return resp.status_code == 200
        except Exception:
            return False

    # ============ 状态查询 ============
    def get_status(self):
        """获取本地模型管理器状态"""
        running = self._get_running_models()
        running_large = [m for m in running if "embed" not in m.lower()]
        external = [m for m in running_large if not self._is_owned_model(m)]
        with self._lock:
            return {
                "active_model": self._active_model,
                "active_since": self._active_since,
                "lock_holder": self._lock_holder,
                "waiting_count": self._waiting_count,
                "total_tasks": self._total_tasks,
                "lock_held": self._global_lock.locked(),
                "running_models": running,
                "owned_models": list(self._owned_models),
                "external_models": external,
                "any_large_loaded": self.is_any_large_model_loaded(),
                "preload_confirmed": self._preload_ok,
                "last_error": self.last_error,
            }

    def force_unload_all(self):
        """强制卸载所有大模型（紧急清理用，不经过锁）"""
        running = self._get_running_models()
        for m in running:
            if "embed" not in m.lower():
                self._unload_model(m)
        with self._lock:
            self._active_model = None
            self._active_since = None
            self._preload_ok = False


# 全局单例
local_model_manager = LocalModelManager()
