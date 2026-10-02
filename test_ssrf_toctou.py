# -*- coding: utf-8 -*-
"""
SSRF TOCTOU / DNS rebinding 回归测试。

所有测试均不发起真实外网请求：
- 私网/localhost/重定向阻断用例走纯逻辑校验
- DNS rebinding 用 mock 的 getaddrinfo / _dns_resolve_host 模拟
- 超时 / 大小限制用本地回环 HTTP 服务器 + 时间 patch
"""
import ipaddress
import socket
import threading
import time
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Tuple
from unittest import mock

import website_evidence as we


# ---------- 本地测试用 HTTP handler ----------

class _QuietHandler(BaseHTTPRequestHandler):
    def log_message(self, *args, **kwargs):
        pass


class _HangHandler(_QuietHandler):
    """接受 TCP 连接但永远不发响应体 —— 用于触发读超时"""
    def do_GET(self):
        try:
            time.sleep(5)  # 远大于 READ_TIMEOUT(0.5s)
        except Exception:
            pass


class _BigBodyHandler(_QuietHandler):
    """返回 > MAX_RESPONSE_BYTES 的响应"""
    def do_GET(self):
        n = we.MAX_RESPONSE_BYTES + 4096
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(n))
            self.end_headers()
            self.wfile.write(b"<html><body>" + b"x" * n + b"</body></html>")
        except (BrokenPipeError, ConnectionResetError):
            pass  # 客户端提前断开，正常


def _start_local_server(handler_cls) -> Tuple[HTTPServer, int]:
    server = HTTPServer(("127.0.0.1", 0), handler_cls)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, port


# ---------- 测试用例 ----------

class TestSSRFTOCTOU(unittest.TestCase):

    # 1. 私网 IP 字面量直接被拒绝
    def test_private_ip_blocked(self):
        for bad in ("10.0.0.5", "192.168.1.1", "172.16.0.1",
                    "172.31.9.9", "169.254.1.1", "0.0.0.0", "127.0.0.1",
                    "[::1]", "[fc00::1]"):
            safe, reason = we.is_safe_url(f"http://{bad}/admin")
            self.assertFalse(safe, f"expected {bad} to be blocked, got safe={safe}")
            self.assertTrue(
                any(k in reason for k in ("私有", "回环", "禁止", "private", "loopback")),
                f"unexpected reason for {bad}: {reason}",
            )

    # 2. localhost 被拒绝
    def test_localhost_blocked(self):
        safe, reason = we.is_safe_url("http://localhost/admin")
        self.assertFalse(safe)
        self.assertIn("localhost", reason.lower())

        safe, reason = we.is_safe_url("http://localhost.localdomain/")
        self.assertFalse(safe)

    # 3a. DNS rebinding：校验时是公网，连接前再次解析变成私网 → 必须拒绝
    def test_dns_rebinding_blocked(self):
        calls = {"n": 0}

        def fake_resolve(hostname):
            calls["n"] += 1
            if calls["n"] == 1:
                # 第一次（is_safe_url 阶段）返回公网（8.8.8.8 是公网，不会被 _is_private_ip 拦）
                return ["8.8.8.8"]
            # 第二次（_pinned_open / _resolve_and_pin 阶段）DNS rebind 到内网
            return ["127.0.0.1"]

        # 先让 is_safe_url 通过（用第一次解析的公网 IP）
        with mock.patch.object(we, "_dns_resolve_host", side_effect=fake_resolve):
            safe, reason = we.is_safe_url("http://rebind.evil.example.com/")
            self.assertTrue(safe, f"pre-check should pass on public IP, got: {reason}")
            # 再真正抓——此时第二次解析返回私网，必须被阻断
            result = we._fetch("http://rebind.evil.example.com/")

        self.assertEqual(result["status"], "failed",
                         f"rebind should be blocked, got {result}")
        self.assertTrue(
            any(k in result["error"] for k in ("Blocked", "私有", "private", "loopback")),
            f"error should mention blocked/private, got: {result['error']}",
        )

    # 3b. 钉住：连接时校验通过的公网 IP 必须就是实际 connect 的目标；
    #     即使后续再有"虚拟的第三次解析"返回私网，也不能影响实际连接。
    def test_dns_rebinding_pin_uses_validated_ip(self):
        connect_targets = []
        real_getaddrinfo = socket.getaddrinfo

        def fake_getaddrinfo(host, port=None, *args, **kwargs):
            # IP 字面量 → 透传（_PinnedHTTPConnection.connect 会用 pinned_ip 再调一次）
            try:
                ipaddress.ip_address(host)
                return real_getaddrinfo(host, port, *args, **kwargs)
            except ValueError:
                pass
            # 域名解析 → 永远返回公网 IP 8.8.8.8
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "",
                     ("8.8.8.8", port or 0))]

        real_socket_connect = socket.socket.connect

        def fake_socket_connect(sa):
            # 注意：patch.object 替换类属性后，self.sock.connect(sa) 调用的是
            # MagicMock(sa)，不会自动传 self。所以这里只接 sa。
            connect_targets.append(sa)
            # 不真的连，直接抛出，让 _pinned_open 走失败分支
            raise OSError("test abort: connection intercepted")

        with mock.patch.object(socket, "getaddrinfo", side_effect=fake_getaddrinfo):
            with mock.patch.object(socket.socket, "connect", side_effect=fake_socket_connect):
                result = we._fetch("http://normal.example.com/")

        # 至少发生一次 connect
        self.assertGreaterEqual(len(connect_targets), 1,
                                "expected at least one connect attempt")
        target_ip = connect_targets[0][0]
        # 实际 connect 目标必须是校验通过的公网 IP，绝不能是私网/回环
        self.assertEqual(target_ip, "8.8.8.8",
                         f"must connect to pinned public IP, got {target_ip}")
        self.assertFalse(we._is_private_ip(target_ip),
                         f"must not connect to private IP: {target_ip}")

    # 4. 重定向到私网被拒绝
    def test_redirect_to_private_blocked(self):
        handler = we._SafeRedirectHandler()
        req = mock.Mock()
        for bad_target in ("http://127.0.0.1/admin",
                           "http://10.0.0.1/internal",
                           "http://localhost/secret"):
            with self.assertRaises(urllib.error.URLError) as ctx:
                handler.redirect_request(req, None, 302, "Found", {}, bad_target)
            self.assertIn("Blocked redirect", str(ctx.exception))

    # 5. 超时生效
    def test_timeout_enforced(self):
        server, port = _start_local_server(_HangHandler)
        try:
            # 缩短超时便于测试
            with mock.patch.object(we, "CONNECT_TIMEOUT", 0.3):
                with mock.patch.object(we, "READ_TIMEOUT", 0.5):
                    with mock.patch.object(we, "TOTAL_TIMEOUT", 3):
                        # 允许本测试访问 127.0.0.1（本地测试服务器）
                        real_is_priv = we._is_private_ip

                        def allow_loopback(ip):
                            if ip in ("127.0.0.1", "::1"):
                                return False
                            return real_is_priv(ip)

                        with mock.patch.object(we, "_is_private_ip",
                                               side_effect=allow_loopback):
                            result = we._fetch(f"http://127.0.0.1:{port}/")
            self.assertEqual(result["status"], "timeout",
                             f"expected timeout, got {result}")
        finally:
            server.shutdown()
            server.server_close()

    # 6. 最大响应大小限制生效
    def test_max_response_size(self):
        server, port = _start_local_server(_BigBodyHandler)
        try:
            real_is_priv = we._is_private_ip

            def allow_loopback(ip):
                if ip in ("127.0.0.1", "::1"):
                    return False
                return real_is_priv(ip)

            with mock.patch.object(we, "_is_private_ip", side_effect=allow_loopback):
                result = we._fetch(f"http://127.0.0.1:{port}/")
            self.assertEqual(result["status"], "too_large",
                             f"expected too_large, got {result}")
            self.assertTrue(result["truncated"])
            self.assertEqual(result["response_size"], we.MAX_RESPONSE_BYTES,
                             f"response_size must equal cap, got {result['response_size']}")
        finally:
            server.shutdown()
            server.server_close()

    # 7. 辅助：确保 file:// / ftp:// 等非法 scheme 被拒
    def test_unsafe_scheme_blocked(self):
        for bad in ("file:///etc/passwd", "ftp://example.com/",
                    "gopher://example.com/", "javascript:alert(1)"):
            safe, _ = we.is_safe_url(bad)
            self.assertFalse(safe, f"{bad} should be blocked")


if __name__ == "__main__":
    unittest.main(verbosity=2)
