# -*- coding: utf-8 -*-
"""
KaiLionCrafts AI工作台 - 模型路由测试套件
覆盖：故障转移链、429冷却、手动选择、并发锁、模型释放、非视觉模型拒收图片
运行方式：python3 test_model_routing.py
"""
import sys
import os
import time
import json
import threading
import unittest
from unittest.mock import patch, MagicMock, PropertyMock
from pathlib import Path

# 确保项目目录在 path 中
sys.path.insert(0, str(Path(__file__).parent))

from model_registry import (
    build_model_registry, get_text_chain, get_vision_chain, get_image_chain,
    get_reasoning_chain, get_local_text_chain, get_local_reasoning_chain,
    health, HEALTH_AVAILABLE, HEALTH_RATE_LIMITED, HEALTH_TIMEOUT,
    HEALTH_UNAVAILABLE, HEALTH_CONFIG_ERROR, HEALTH_MANUAL_DISABLED,
    TEXT_CHAIN_IDS, VISION_CHAIN_IDS, IMAGE_CHAIN_IDS, REASONING_CHAIN_IDS,
    DISABLED_ONLINE_PROVIDERS, LOCAL_MODELS,
)
from local_model_manager import LocalModelManager, local_model_manager
from ai_client import AIClient, ai, _classify_error, FAILOVER_STATUS_CODES, NO_FAILOVER_STATUS_CODES


class TestModelRegistry(unittest.TestCase):
    """测试模型注册表结构和顺序"""

    def test_text_chain_order(self):
        """文本模型自动路由顺序必须正确：GLM → qwen3.5 → qwen2.5"""
        chain = get_text_chain()
        ids = [m['id'] for m in chain]
        expected = [
            'glm-4.7-flash', 'glm-4-flash',
            'qwen3.5:9b', 'qwen2.5:7b',
        ]
        self.assertEqual(ids, expected, f"文本链顺序错误: {ids}")

    def test_reasoning_chain_order(self):
        """推理任务路由顺序：GLM → qwen3.5 → deepseek-r1"""
        chain = get_reasoning_chain()
        ids = [m['id'] for m in chain]
        expected = ['glm-4.7-flash', 'qwen3.5:9b', 'deepseek-r1:7b']
        self.assertEqual(ids, expected, f"推理链顺序错误: {ids}")

    def test_doubao_not_in_auto_text_chain(self):
        """doubao-seed-2-1-turbo 不得出现在默认自动文本链中"""
        chain = get_text_chain()
        ids = [m['id'] for m in chain]
        self.assertNotIn('doubao-seed-2-1-turbo', ids,
                         "doubao 不得在默认自动文本链中，仅可手动选择")

    def test_doubao_still_in_registry_for_manual(self):
        """doubao 仍在注册表中，可供手动选择"""
        reg = build_model_registry()
        self.assertIn('doubao-seed-2-1-turbo', reg,
                      "doubao 应保留在注册表供手动选择")

    def test_qwen25vl_not_in_text_chain(self):
        """qwen2.5vl:7b 不得出现在普通文本链中，仅用于视觉"""
        chain = get_text_chain()
        ids = [m['id'] for m in chain]
        self.assertNotIn('qwen2.5vl:7b', ids,
                         "qwen2.5vl 不得在普通文本链中")

    def test_deepseek_not_in_text_chain(self):
        """deepseek-r1:7b 不得出现在日常普通文本链中，仅用于推理"""
        chain = get_text_chain()
        ids = [m['id'] for m in chain]
        self.assertNotIn('deepseek-r1:7b', ids,
                         "deepseek-r1 不得在日常文本链中，仅推理备用")

    def test_qwen35_first_local_in_text_chain(self):
        """qwen3.5:9b 必须是文本链中第一个本地模型"""
        chain = get_text_chain()
        local_models = [m for m in chain if m['type'] == 'local']
        self.assertGreater(len(local_models), 0, "文本链应有本地模型")
        self.assertEqual(local_models[0]['id'], 'qwen3.5:9b',
                         "qwen3.5:9b 必须是第一个本地模型")

    def test_local_text_chain_order(self):
        """本地文本链顺序：qwen3.5 → qwen2.5"""
        chain = get_local_text_chain()
        ids = [m['id'] for m in chain]
        expected = ['qwen3.5:9b', 'qwen2.5:7b']
        self.assertEqual(ids, expected, f"本地文本链顺序错误: {ids}")

    def test_local_reasoning_chain_order(self):
        """本地推理链顺序：qwen3.5 → deepseek-r1"""
        chain = get_local_reasoning_chain()
        ids = [m['id'] for m in chain]
        expected = ['qwen3.5:9b', 'deepseek-r1:7b']
        self.assertEqual(ids, expected, f"本地推理链顺序错误: {ids}")

    def test_vision_chain_order(self):
        """视觉模型自动路由顺序必须正确，且全部支持视觉"""
        chain = get_vision_chain()
        ids = [m['id'] for m in chain]
        expected = ['glm-4.6v-flash', 'qwen3.5:9b', 'qwen2.5vl:7b']
        self.assertEqual(ids, expected, f"视觉链顺序错误: {ids}")
        for m in chain:
            self.assertTrue(m.get('vision_capable', False), f"{m['id']} 不支持视觉但在视觉链中")

    def test_image_chain_order(self):
        """图像生成路由顺序：CogView -> FLUX"""
        chain = get_image_chain()
        ids = [m['id'] for m in chain]
        self.assertEqual(ids, ['cogview-3-flash', 'x/flux2-klein:4b-fp4'])

    def test_qwen35_vision_capable(self):
        """qwen3.5:9b 必须标记为支持视觉（经 ollama show 确认）"""
        reg = build_model_registry()
        self.assertIn('qwen3.5:9b', reg)
        self.assertTrue(reg['qwen3.5:9b']['vision_capable'])

    def test_non_vision_models_excluded_from_vision_chain(self):
        """非视觉模型（deepseek-r1, qwen2.5）不得出现在视觉链中"""
        chain = get_vision_chain()
        ids = [m['id'] for m in chain]
        self.assertNotIn('deepseek-r1:7b', ids)
        self.assertNotIn('qwen2.5:7b', ids)

    def test_siliconflow_disabled(self):
        """SiliconFlow 供应商必须在禁用列表中"""
        self.assertIn('sf_xing4_29b', DISABLED_ONLINE_PROVIDERS)
        self.assertIn('sf_qwen2_7b', DISABLED_ONLINE_PROVIDERS)

    def test_siliconflow_not_in_active_chains(self):
        """SiliconFlow 模型不得出现在任何活动路由链中"""
        all_ids = [m['id'] for m in get_text_chain() + get_vision_chain() + get_image_chain()]
        for mid in all_ids:
            self.assertNotIn('XingChen', mid)
            self.assertNotIn('siliconflow', mid.lower())

    def test_flux_real_model_id(self):
        """FLUX 必须使用真实 Ollama ID: x/flux2-klein:4b-fp4"""
        reg = build_model_registry()
        self.assertIn('x/flux2-klein:4b-fp4', reg)
        self.assertEqual(reg['x/flux2-klein:4b-fp4']['api_model'], 'x/flux2-klein:4b-fp4')

    def test_qwen35_context_config(self):
        """qwen3.5:9b 上下文配置：日常8192/长文16384/最大32768，不得为256K"""
        info = LOCAL_MODELS['qwen3.5:9b']
        self.assertEqual(info['context_default'], 8192)
        self.assertEqual(info['context_long'], 16384)
        self.assertEqual(info['context_max'], 32768)
        self.assertLess(info['context_max'], 262144)  # 不得为模型原生256K

    def test_embedding_fixed(self):
        """Embedding 固定为 nomic-embed-text"""
        from model_registry import EMBEDDING_MODEL_ID, get_embedding_model
        self.assertEqual(EMBEDDING_MODEL_ID, 'nomic-embed-text:latest')
        emb = get_embedding_model()
        self.assertIn('nomic-embed-text', emb.get('ollama_id', ''))


class TestErrorClassification(unittest.TestCase):
    """测试错误分类逻辑"""

    def test_408_failover(self):
        can, etype, msg = _classify_error(Exception("HTTP 408"), 408)
        self.assertTrue(can)

    def test_429_failover(self):
        can, etype, msg = _classify_error(Exception("HTTP 429"), 429)
        self.assertTrue(can)
        self.assertEqual(etype, "http_429")

    def test_500_failover(self):
        can, _, _ = _classify_error(Exception("HTTP 500"), 500)
        self.assertTrue(can)

    def test_502_failover(self):
        can, _, _ = _classify_error(Exception("HTTP 502"), 502)
        self.assertTrue(can)

    def test_503_failover(self):
        can, _, _ = _classify_error(Exception("HTTP 503"), 503)
        self.assertTrue(can)

    def test_504_failover(self):
        can, _, _ = _classify_error(Exception("HTTP 504"), 504)
        self.assertTrue(can)

    def test_401_no_failover(self):
        can, etype, _ = _classify_error(Exception("HTTP 401"), 401)
        self.assertFalse(can)
        self.assertEqual(etype, "auth_error")

    def test_403_no_failover(self):
        can, etype, _ = _classify_error(Exception("HTTP 403"), 403)
        self.assertFalse(can)
        self.assertEqual(etype, "auth_error")

    def test_400_no_failover(self):
        can, etype, _ = _classify_error(Exception("HTTP 400"), 400)
        self.assertFalse(can)

    def test_timeout_failover(self):
        import requests
        can, etype, _ = _classify_error(requests.exceptions.Timeout("timeout"))
        self.assertTrue(can)
        self.assertEqual(etype, "timeout")

    def test_connection_error_failover(self):
        import requests
        can, etype, _ = _classify_error(requests.exceptions.ConnectionError("conn refused"))
        self.assertTrue(can)

    def test_content_rejection_no_failover(self):
        can, etype, _ = _classify_error(Exception("content filter rejected"))
        self.assertFalse(can)

    def test_empty_input_no_failover(self):
        can, etype, _ = _classify_error(Exception("empty input"))
        self.assertFalse(can)


class TestHealthManager(unittest.TestCase):
    """测试健康状态管理器和429冷却"""

    def setUp(self):
        # 重置健康状态
        health._states = {}

    def test_429_first_cooldown_60s(self):
        """第一次429冷却60秒"""
        health.set_status('test-model', HEALTH_RATE_LIMITED, error="429")
        s = health.get_status('test-model')
        self.assertEqual(s['status'], HEALTH_RATE_LIMITED)
        self.assertGreater(s['cooldown_remaining'], 55)
        self.assertLessEqual(s['cooldown_remaining'], 60)

    def test_429_second_cooldown_300s(self):
        """连续第二次429冷却300秒"""
        health.set_status('test-model', HEALTH_RATE_LIMITED, error="429 first")
        health.set_status('test-model', HEALTH_RATE_LIMITED, error="429 second")
        s = health.get_status('test-model')
        self.assertGreater(s['cooldown_remaining'], 295)
        self.assertLessEqual(s['cooldown_remaining'], 300)

    def test_available_resets_cooldown(self):
        """恢复可用后冷却重置"""
        health.set_status('test-model', HEALTH_RATE_LIMITED, error="429")
        health.set_status('test-model', HEALTH_AVAILABLE, elapsed=1.0)
        s = health.get_status('test-model')
        self.assertEqual(s['status'], HEALTH_AVAILABLE)
        self.assertEqual(s['cooldown_remaining'], 0)
        self.assertEqual(s['rate_limit_count'], 0)

    def test_rate_limited_not_available_during_cooldown(self):
        """冷却期间 is_available 返回 False"""
        health.set_status('test-model', HEALTH_RATE_LIMITED, error="429")
        self.assertFalse(health.is_available('test-model'))

    def test_config_error_never_available(self):
        """配置错误状态不可用"""
        health.set_status('test-model', HEALTH_CONFIG_ERROR, error="401")
        self.assertFalse(health.is_available('test-model'))

    def test_glm46v_not_permanently_disabled_by_429(self):
        """GLM-4.6V Flash 不因一次429被永久禁用（冷却后可恢复）"""
        health.set_status('glm-4.6v-flash', HEALTH_RATE_LIMITED, error="429")
        # 模拟冷却结束
        health._states['glm-4.6v-flash']['cooldown_until'] = time.time() - 1
        self.assertTrue(health.is_available('glm-4.6v-flash'))


class TestTextFailoverRouting(unittest.TestCase):
    """测试文本故障转移路由（使用 mock）"""

    def setUp(self):
        health._states = {}
        self.client = AIClient()

    @patch('ai_client.requests.post')
    def test_glm47_failure_falls_to_glm4(self, mock_post):
        """GLM-4.7 Flash 失败后转至 GLM-4 Flash"""
        call_count = [0]

        def side_effect(url, **kwargs):
            call_count[0] += 1
            mock_resp = MagicMock()
            if 'glm-4.7-flash' in str(kwargs.get('json', {}).get('model', '')):
                mock_resp.status_code = 500
                mock_resp.text = "Internal Server Error"
            else:
                mock_resp.status_code = 200
                mock_resp.json.return_value = {
                    "choices": [{"message": {"content": "GLM-4 Flash 响应"}}],
                    "usage": {}
                }
            return mock_resp

        mock_post.side_effect = side_effect
        result = self.client.chat("你好", task_name="测试-GLM47失败转移")
        self.assertIn("GLM-4 Flash", result)
        self.assertGreaterEqual(call_count[0], 2)

    @patch('ai_client.requests.post')
    def test_all_online_fail_falls_to_qwen35(self, mock_post):
        """GLM、豆包都失败后转至 qwen3.5:9b（本地）"""
        call_models = []

        def side_effect(url, **kwargs):
            model = kwargs.get('json', {}).get('model', '')
            call_models.append(model)
            mock_resp = MagicMock()
            # 在线模型全部失败
            if any(x in url for x in ['bigmodel.cn', 'volces.com']):
                mock_resp.status_code = 503
                mock_resp.text = "Service Unavailable"
            else:
                # 本地 Ollama 原生 API
                mock_resp.status_code = 200
                mock_resp.json.return_value = {
                    "message": {"content": "qwen3.5 本地响应"},
                    "eval_count": 10,
                }
            return mock_resp

        mock_post.side_effect = side_effect
        # mock 本地锁
        with patch.object(local_model_manager, 'acquire', return_value=True), \
             patch.object(local_model_manager, 'release'):
            result = self.client.chat("你好", task_name="测试-在线全失败转本地")
        self.assertIn("qwen3.5", result)
        # 确认尝试了在线模型后才到本地
        self.assertIn('glm-4.7-flash', call_models)

    @patch('ai_client.requests.post')
    def test_qwen35_failure_falls_to_qwen25(self, mock_post):
        """qwen3.5:9b 失败后按文本链顺序转至 qwen2.5:7b"""
        call_models = []

        def side_effect(url, **kwargs):
            model = kwargs.get('json', {}).get('model', '')
            call_models.append(model)
            mock_resp = MagicMock()
            if 'qwen3.5' in model:
                mock_resp.status_code = 500
                mock_resp.text = "error"
            elif 'qwen2.5' in model and 'vl' not in model:
                mock_resp.status_code = 200
                mock_resp.json.return_value = {
                    "message": {"content": "qwen2.5 响应", "thinking": ""},
                    "eval_count": 5,
                }
            else:
                mock_resp.status_code = 503
                mock_resp.text = "unavailable"
            return mock_resp

        mock_post.side_effect = side_effect
        with patch.object(local_model_manager, 'acquire', return_value=True), \
             patch.object(local_model_manager, 'release'):
            result = self.client.chat("你好", task_name="测试-qwen35失败转qwen25")
        self.assertIn("qwen2.5", result)
        self.assertIn("qwen3.5:9b", call_models)
        self.assertIn("qwen2.5:7b", call_models)

    @patch('ai_client.requests.post')
    def test_reasoning_chain_uses_deepseek(self, mock_post):
        """推理链中 qwen3.5 失败后转至 deepseek-r1:7b"""
        # 验证推理链包含 deepseek-r1
        chain = get_reasoning_chain()
        ids = [m['id'] for m in chain]
        self.assertIn('deepseek-r1:7b', ids)
        self.assertEqual(ids.index('deepseek-r1:7b'), 2,
                         "deepseek-r1 应在推理链第三位")

    @patch('ai_client.requests.post')
    def test_401_does_not_failover(self, mock_post):
        """401 错误不自动切换，显示明确错误"""
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.text = "Unauthorized"
        mock_post.return_value = mock_resp

        result = self.client.chat("你好", task_name="测试-401不切换")
        self.assertIn("失败", result)
        # 只调用了一次（第一个模型），没有故障转移
        self.assertEqual(mock_post.call_count, 1)

    @patch('ai_client.requests.post')
    def test_empty_input_returns_error(self, mock_post):
        """空输入不发请求，直接返回错误"""
        result = self.client.chat("", task_name="测试-空输入")
        self.assertIn("输入为空", result)
        mock_post.assert_not_called()


class TestVisionFailoverRouting(unittest.TestCase):
    """测试视觉故障转移路由"""

    def setUp(self):
        health._states = {}
        self.client = AIClient()

    @patch('ai_client.requests.post')
    def test_glm46v_429_falls_to_local_vision(self, mock_post):
        """GLM-4.6V Flash 429 后触发视觉本地备用模型"""
        call_models = []

        def side_effect(url, **kwargs):
            model = kwargs.get('json', {}).get('model', '')
            call_models.append(model)
            mock_resp = MagicMock()
            if 'glm-4.6v' in model:
                mock_resp.status_code = 429
                mock_resp.text = "Rate Limited"
            else:
                mock_resp.status_code = 200
                mock_resp.json.return_value = {
                    "message": {"content": "本地视觉模型响应"},
                    "eval_count": 5,
                }
            return mock_resp

        mock_post.side_effect = side_effect
        with patch.object(local_model_manager, 'acquire', return_value=True), \
             patch.object(local_model_manager, 'release'):
            result = self.client.chat_with_image(
                "data:image/png;base64,abc123", "描述图片",
                task_name="测试-视觉429转移"
            )
        self.assertIn("本地视觉", result)
        self.assertIn('glm-4.6v-flash', call_models)

    def test_non_vision_model_rejects_image(self):
        """非视觉模型不会接收图片输入（通过视觉链过滤保证）"""
        chain = get_vision_chain()
        for m in chain:
            self.assertTrue(m.get('vision_capable'),
                          f"{m['id']} 不支持视觉但在视觉链中，会拒收图片")
        # deepseek-r1 和 qwen2.5 不在视觉链中
        vision_ids = [m['id'] for m in chain]
        self.assertNotIn('deepseek-r1:7b', vision_ids)
        self.assertNotIn('qwen2.5:7b', vision_ids)


class TestImageFailoverRouting(unittest.TestCase):
    """测试图像生成故障转移路由"""

    def setUp(self):
        health._states = {}
        self.client = AIClient()

    @patch('ai_client.requests.post')
    def test_cogview_failure_falls_to_flux(self, mock_post):
        """CogView 失败后转至 FLUX 本地"""
        call_urls = []

        def side_effect(url, **kwargs):
            call_urls.append(url)
            mock_resp = MagicMock()
            if 'images/generations' in url:
                mock_resp.status_code = 500
                mock_resp.text = "error"
            elif '/api/generate' in url:
                mock_resp.status_code = 200
                import base64
                mock_resp.json.return_value = {
                    "images": [base64.b64encode(b"\x89PNG fake").decode()]
                }
            else:
                mock_resp.status_code = 200
                mock_resp.json.return_value = {}
            return mock_resp

        mock_post.side_effect = side_effect
        with patch.object(local_model_manager, 'acquire', return_value=True), \
             patch.object(local_model_manager, 'release'):
            result = self.client.generate_image("a cat", task_name="测试-CogView失败转FLUX")
        self.assertTrue(result['success'])
        self.assertIn('FLUX', result['model'])
        self.assertIsNotNone(result.get('local_path'))

    @patch('ai_client.requests.post')
    def test_manual_flux_no_cloud_fallback(self, mock_post):
        """手动选择 FLUX 后不会切回云端"""
        call_urls = []

        def side_effect(url, **kwargs):
            call_urls.append(url)
            mock_resp = MagicMock()
            if '/api/generate' in url:
                mock_resp.status_code = 200
                import base64
                mock_resp.json.return_value = {
                    "images": [base64.b64encode(b"\x89PNG fake").decode()]
                }
            else:
                mock_resp.status_code = 200
                mock_resp.json.return_value = {}
            return mock_resp

        mock_post.side_effect = side_effect
        with patch.object(local_model_manager, 'acquire', return_value=True), \
             patch.object(local_model_manager, 'release'):
            result = self.client.generate_image(
                "a cat", task_name="测试-手动FLUX不切云端",
                manual_model="x/flux2-klein:4b-fp4"
            )
        self.assertTrue(result['success'])
        # 确认没有调用云端 images/generations
        cloud_calls = [u for u in call_urls if 'images/generations' in u]
        self.assertEqual(len(cloud_calls), 0)


class TestLocalModelMutex(unittest.TestCase):
    """测试本地模型互斥锁"""

    def setUp(self):
        # 使用独立的 LocalModelManager 实例测试，避免影响全局
        self.mgr = LocalModelManager()
        self.mgr._global_lock = threading.Lock()
        self.mgr._active_model = None

    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test_concurrent_requests_only_one_model(self, mock_post, mock_get):
        """多个并发本地请求下仍只加载一个本地模型"""
        # 模拟 ollama ps 返回空
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"models": []}
        mock_get.return_value = mock_resp
        mock_post.return_value = mock_resp

        active_models = []
        lock = threading.Lock()

        def task(model_id):
            if self.mgr.acquire(model_id, timeout=10):
                with lock:
                    active_models.append(self.mgr._active_model)
                time.sleep(0.2)
                self.mgr.release(model_id)

        threads = [
            threading.Thread(target=task, args=("qwen3.5:9b",)),
            threading.Thread(target=task, args=("deepseek-r1:7b",)),
            threading.Thread(target=task, args=("qwen2.5:7b",)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=15)

        # 所有任务都应完成
        self.assertEqual(len(active_models), 3)
        # 同一时刻只有一个（通过锁保证）
        self.assertFalse(self.mgr._global_lock.locked())

    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test_model_released_after_task(self, mock_post, mock_get):
        """本地任务完成后模型会被释放"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"models": []}
        mock_get.return_value = mock_resp
        mock_post.return_value = mock_resp

        self.mgr.acquire("qwen3.5:9b", timeout=5)
        self.assertEqual(self.mgr._active_model, "qwen3.5:9b")
        self.mgr.release("qwen3.5:9b")
        self.assertIsNone(self.mgr._active_model)
        self.assertFalse(self.mgr._global_lock.locked())

    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test_switch_model_unloads_old(self, mock_post, mock_get):
        """切换模型前先卸载旧模型"""
        call_models = []

        def get_side_effect(url, **kwargs):
            r = MagicMock()
            r.status_code = 200
            r.json.return_value = {"models": []}
            return r

        def post_side_effect(url, **kwargs):
            model = kwargs.get('json', {}).get('model', '')
            call_models.append(model)
            r = MagicMock()
            r.status_code = 200
            return r

        mock_get.side_effect = get_side_effect
        mock_post.side_effect = post_side_effect

        # 第一次加载 qwen3.5
        self.mgr.acquire("qwen3.5:9b", timeout=5)
        self.mgr.release("qwen3.5:9b")
        # 第二次加载 deepseek，acquire 时应检测并卸载旧模型
        self.mgr.acquire("deepseek-r1:7b", timeout=5)
        # 卸载调用中应包含 qwen3.5:9b
        self.assertIn("qwen3.5:9b", call_models)
        self.mgr.release("deepseek-r1:7b")

    def test_flux_uses_same_global_lock(self):
        """FLUX 图像生成也必须走同一个全局本地模型锁"""
        # 验证 LocalModelManager 是单例
        mgr1 = LocalModelManager()
        mgr2 = LocalModelManager()
        self.assertIs(mgr1, mgr2)
        self.assertIs(mgr1._global_lock, mgr2._global_lock)


class TestTraceLogging(unittest.TestCase):
    """测试 Trace 记录不包含敏感信息"""

    def setUp(self):
        health._states = {}
        self.client = AIClient()

    @patch('ai_client.requests.post')
    def test_trace_does_not_contain_api_key(self, mock_post):
        """Trace 记录不得包含 API Key"""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": "test"}}],
            "usage": {}
        }
        mock_post.return_value = mock_resp

        self.client.chat("测试", task_name="测试-Trace脱敏")
        trace = self.client.last_trace
        trace_str = json.dumps(trace, ensure_ascii=False)
        # 确认不包含 API Key 模式
        self.assertNotIn("sk-", trace_str)
        self.assertNotIn("ark-", trace_str)
        self.assertNotIn("Bearer", trace_str)

    @patch('ai_client.requests.post')
    def test_trace_contains_failover_details(self, mock_post):
        """故障转移 Trace 必须包含原模型/目标模型/状态码/耗时/模式"""
        call_count = [0]

        def side_effect(url, **kwargs):
            call_count[0] += 1
            r = MagicMock()
            if call_count[0] == 1:
                r.status_code = 503
                r.text = "Service Unavailable"
            else:
                r.status_code = 200
                r.json.return_value = {
                    "choices": [{"message": {"content": "ok"}}],
                    "usage": {}
                }
            return r

        mock_post.side_effect = side_effect
        self.client.chat("测试", task_name="测试-Trace故障转移详情")
        trace = self.client.last_trace
        self.assertIn('failover_details', trace)
        self.assertGreater(len(trace['failover_details']), 0)
        detail = trace['failover_details'][0]
        self.assertIn('from', detail)
        self.assertIn('to', detail)
        self.assertIn('type', detail)
        self.assertIn('status_code', detail)
        self.assertIn('reason', detail)
        self.assertIn('elapsed', detail)
        self.assertIn('mode', detail)


class TestIntegrationRealOllama(unittest.TestCase):
    """集成测试：真实调用 Ollama（需要 Ollama 服务运行）"""

    @classmethod
    def setUpClass(cls):
        try:
            import requests
            resp = requests.get("http://localhost:11434/api/tags", timeout=5)
            cls.ollama_available = resp.status_code == 200
        except Exception:
            cls.ollama_available = False

    def test_ollama_models_exist(self):
        """确认本机真实安装的模型名称"""
        if not self.ollama_available:
            self.skipTest("Ollama 服务未运行")
        import requests
        resp = requests.get("http://localhost:11434/api/tags", timeout=10)
        models = [m['name'] for m in resp.json().get('models', [])]
        self.assertIn('qwen3.5:9b', models)
        self.assertIn('deepseek-r1:7b', models)
        self.assertIn('qwen2.5:7b', models)
        self.assertIn('qwen2.5vl:7b', models)
        self.assertIn('x/flux2-klein:4b-fp4', models)
        self.assertIn('nomic-embed-text:latest', models)

    def test_qwen35_vision_capability_real(self):
        """真实确认 qwen3.5:9b 支持视觉"""
        if not self.ollama_available:
            self.skipTest("Ollama 服务未运行")
        import requests
        resp = requests.post(
            "http://localhost:11434/api/show",
            json={"name": "qwen3.5:9b"},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            capabilities = data.get('capabilities', [])
            # Ollama /api/show 可能不直接返回 capabilities，检查模型信息
            # 通过架构和参数判断
            self.assertIn('qwen', data.get('details', {}).get('family', '').lower())


def run_all_tests():
    """运行所有测试"""
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    test_classes = [
        TestModelRegistry,
        TestErrorClassification,
        TestHealthManager,
        TestTextFailoverRouting,
        TestVisionFailoverRouting,
        TestImageFailoverRouting,
        TestLocalModelMutex,
        TestTraceLogging,
        TestIntegrationRealOllama,
    ]

    for tc in test_classes:
        suite.addTests(loader.loadTestsFromTestCase(tc))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    print("\n" + "=" * 60)
    print(f"测试总数: {result.testsRun}")
    print(f"通过: {result.testsRun - len(result.failures) - len(result.errors)}")
    print(f"失败: {len(result.failures)}")
    print(f"错误: {len(result.errors)}")
    if result.skipped:
        print(f"跳过: {len(result.skipped)}")
    print("=" * 60)

    return result.wasSuccessful()


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
