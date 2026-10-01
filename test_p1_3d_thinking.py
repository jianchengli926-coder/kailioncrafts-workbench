# -*- coding: utf-8 -*-
"""
P1.3D: qwen3.5 thinking 输出修复测试
覆盖：response/thinking 处理、标准模式关闭thinking、空响应故障转移
"""
import unittest
import json
from unittest.mock import patch, MagicMock
from pathlib import Path

import ai_client
from ai_client import AIClient


class TestThinkingHandling(unittest.TestCase):
    """测试 thinking 输出处理"""

    def setUp(self):
        self.ai = AIClient()
        self.model_info = {
            "id": "qwen3.5:9b",
            "api_model": "qwen3.5:9b",
            "display_name": "Qwen3.5 9B",
            "type": "local",
            "base_url": "http://127.0.0.1:11434",
            "context_default": 8192,
            "context_max": 32768,
        }

    def test_response_has_content_uses_response(self):
        """response 有内容时使用 response，不使用 thinking"""
        resp = MagicMock()
        resp.json.return_value = {
            "message": {
                "content": "This is the actual response.",
                "thinking": "This is the thinking process."
            },
            "eval_count": 50
        }
        content, usage, thinking_meta = self.ai._parse_local_chat_response(resp)
        self.assertEqual(content, "This is the actual response.")
        self.assertTrue(thinking_meta["has_thinking"])
        self.assertFalse(thinking_meta["empty_response"])

    def test_empty_response_with_thinking_rejected(self):
        """response 为空、thinking 有内容时，返回空 content，不保存 thinking"""
        resp = MagicMock()
        resp.json.return_value = {
            "message": {
                "content": "",
                "thinking": "This is the thinking process only."
            },
            "eval_count": 500
        }
        content, usage, thinking_meta = self.ai._parse_local_chat_response(resp)
        self.assertEqual(content, "")
        self.assertTrue(thinking_meta["has_thinking"])
        self.assertTrue(thinking_meta["empty_response"])
        # thinking 内容保留在 meta 中，但不进入 content
        self.assertIn("thinking", thinking_meta)
        self.assertEqual(thinking_meta["thinking"], "This is the thinking process only.")

    def test_thinking_not_in_body(self):
        """thinking 不进入 body（通过空 content 实现）"""
        resp = MagicMock()
        resp.json.return_value = {
            "message": {
                "content": "",
                "thinking": "Step 1: Analyze... Step 2: Plan..."
            },
            "eval_count": 500
        }
        content, _, thinking_meta = self.ai._parse_local_chat_response(resp)
        # content 为空，调用方应触发故障转移而非使用 thinking
        self.assertEqual(content, "")
        self.assertTrue(thinking_meta["empty_response"])

    def test_thinking_not_in_confirmed_claims(self):
        """thinking 不进入 confirmed_claims（草稿生成器只使用 content）"""
        # 模拟 content_draft_generator 的行为：只使用 response content
        resp = MagicMock()
        resp.json.return_value = {
            "message": {
                "content": "Subject: Test\n\nBody content here.",
                "thinking": "Internal reasoning about claims."
            },
            "eval_count": 50
        }
        content, _, _ = self.ai._parse_local_chat_response(resp)
        # confirmed_claims 应该从 content 解析，不包含 thinking
        self.assertNotIn("Internal reasoning", content)
        self.assertIn("Body content here", content)

    def test_standard_mode_disables_thinking(self):
        """标准模式默认关闭 thinking"""
        with patch('ai_client.requests.post') as mock_post:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {
                "message": {"content": "OK"},
                "eval_count": 10
            }
            mock_post.return_value = mock_resp

            self.ai._call_local_chat(self.model_info, [{"role": "user", "content": "hi"}], thinking=False)

            # 检查请求参数中 thinking=False
            call_args = mock_post.call_args
            options = call_args[1]['json']['options']
            self.assertIn('thinking', options)
            self.assertFalse(options['thinking'])

    def test_reasoning_mode_enables_thinking(self):
        """深度推理模式可以启用 thinking"""
        with patch('ai_client.requests.post') as mock_post:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {
                "message": {"content": "OK", "thinking": "reasoning..."},
                "eval_count": 10
            }
            mock_post.return_value = mock_resp

            self.ai._call_local_chat(self.model_info, [{"role": "user", "content": "hi"}], thinking=True)

            call_args = mock_post.call_args
            options = call_args[1]['json']['options']
            self.assertTrue(options['thinking'])

    def test_empty_response_triggers_failover_in_standard_mode(self):
        """标准模式下空响应（仅thinking）触发故障转移"""
        # 这个测试验证 chat 方法中的逻辑，需要 mock 更多组件
        # 这里只验证 _parse_local_chat_response 返回正确的标记
        resp = MagicMock()
        resp.json.return_value = {
            "message": {
                "content": "",
                "thinking": "Only thinking, no response."
            },
            "eval_count": 500
        }
        content, _, thinking_meta = self.ai._parse_local_chat_response(resp)
        self.assertTrue(thinking_meta["empty_response"])
        self.assertTrue(thinking_meta["has_thinking"])
        # chat 方法中会检查 mode != "reasoning" 并触发故障转移
        # 这里验证标记正确

    def test_keep_alive_zero_still_works(self):
        """keep_alive=0 仍然生效（请求结束后立即释放模型）"""
        with patch('ai_client.requests.post') as mock_post:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {"message": {"content": "OK"}, "eval_count": 10}
            mock_post.return_value = mock_resp

            self.ai._call_local_chat(self.model_info, [{"role": "user", "content": "hi"}])
            call_args = mock_post.call_args
            # 请求中 keep_alive=0，请求结束后立即释放模型
            self.assertEqual(call_args[1]['json']['keep_alive'], 0)

    def test_num_ctx_8192_default(self):
        """num_ctx 默认 8192"""
        with patch('ai_client.requests.post') as mock_post:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {"message": {"content": "OK"}, "eval_count": 10}
            mock_post.return_value = mock_resp

            self.ai._call_local_chat(self.model_info, [{"role": "user", "content": "hi"}])
            call_args = mock_post.call_args
            options = call_args[1]['json']['options']
            self.assertEqual(options['num_ctx'], 8192)

    def test_online_reasoning_content_not_used_as_response(self):
        """在线模型 reasoning_content 不作为 response 使用"""
        # 这个逻辑在 chat 方法中，验证 _parse 不处理在线响应
        # 在线响应的处理在 chat 方法中直接检查 msg.get("reasoning_content")
        # 这里验证 _parse_local_chat_response 只处理本地格式
        resp = MagicMock()
        resp.json.return_value = {
            "message": {
                "content": "",
                "reasoning_content": "Online reasoning only."
            },
            "eval_count": 50
        }
        content, _, thinking_meta = self.ai._parse_local_chat_response(resp)
        # 本地解析器不识别 reasoning_content，只识别 thinking
        self.assertEqual(content, "")
        self.assertFalse(thinking_meta["has_thinking"])  # 没有 thinking 字段
        self.assertTrue(thinking_meta["empty_response"])


class TestOllamaCompatibility(unittest.TestCase):
    """测试 Ollama 版本兼容性"""

    def test_response_format_without_thinking_field(self):
        """兼容没有 thinking 字段的旧版 Ollama 响应"""
        resp = MagicMock()
        resp.json.return_value = {
            "message": {"content": "Normal response."},
            "eval_count": 50
        }
        ai = AIClient()
        content, usage, thinking_meta = ai._parse_local_chat_response(resp)
        self.assertEqual(content, "Normal response.")
        self.assertFalse(thinking_meta["has_thinking"])
        self.assertFalse(thinking_meta["empty_response"])

    def test_response_format_with_empty_message(self):
        """兼容 message 为空的异常响应"""
        resp = MagicMock()
        resp.json.return_value = {
            "message": {},
            "eval_count": 0
        }
        ai = AIClient()
        content, usage, thinking_meta = ai._parse_local_chat_response(resp)
        self.assertEqual(content, "")
        self.assertTrue(thinking_meta["empty_response"])


if __name__ == '__main__':
    unittest.main(verbosity=2)
