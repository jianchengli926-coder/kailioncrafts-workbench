# -*- coding: utf-8 -*-
"""KaiLionCrafts AI工作台 - 模型路由测试套件 v2.0 - 覆盖全部16项验收标准"""
import sys, os, time, json, threading, unittest
from unittest.mock import patch, MagicMock
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from model_registry import (build_model_registry, get_text_chain, get_vision_chain,
    get_image_chain, get_local_text_chain, health, TEXT_CHAIN_IDS, VISION_CHAIN_IDS,
    IMAGE_CHAIN_IDS, DISABLED_ONLINE_PROVIDERS, LOCAL_MODELS,
    HEALTH_AVAILABLE, HEALTH_RATE_LIMITED, HEALTH_CONFIG_ERROR,
    check_ollama_image_gen_support)
from local_model_manager import LocalModelManager, local_model_manager, OLLAMA_BASE
from ai_client import AIClient, ai, _classify_error

class MockPs:
    def __init__(self, target):
        self.target = target; self.phase = 0
    def __call__(self, url, **kw):
        r = MagicMock(); r.status_code = 200
        if self.phase == 0: r.json.return_value = {"models": []}; self.phase = 1
        elif self.phase == 1: r.json.return_value = {"models": [{"name": self.target, "size": "5GB"}]}; self.phase = 2
        else: r.json.return_value = {"models": []}; self.phase = 0
        return r

def _p_ok():
    r = MagicMock(); r.status_code = 200; return r
def _p_preload():
    r = MagicMock(); r.status_code = 200; r.json.return_value = {"message": {"content": "hi"}, "eval_count": 1}; return r

class T1Chain(unittest.TestCase):
    def test_4models(self): self.assertEqual(len(get_text_chain()), 4)
    def test_order(self):
        ids = [m['id'] for m in get_text_chain()]
        self.assertEqual(ids, ['glm-4.7-flash','glm-4-flash','qwen3.5:9b','qwen2.5:7b'])
    def test_no_doubao(self): self.assertNotIn('doubao-seed-2-1-turbo', [m['id'] for m in get_text_chain()])
    def test_no_deepseek(self): self.assertNotIn('deepseek-r1:7b', [m['id'] for m in get_text_chain()])
    def test_no_qwen25vl(self): self.assertNotIn('qwen2.5vl:7b', [m['id'] for m in get_text_chain()])
    def test_qwen35_first_local(self):
        ids = [m['id'] for m in get_text_chain()]
        local_ids = [m for m in ids if ':' in m]
        self.assertEqual(local_ids[0], 'qwen3.5:9b')
    def test_local2(self):
        ids = [m['id'] for m in get_local_text_chain()]
        self.assertEqual(ids, ['qwen3.5:9b','qwen2.5:7b'])

class T1RegistryDetail(unittest.TestCase):
    """恢复 f2053c1 的模型注册表详细测试"""
    def test_doubao_still_in_registry(self):
        reg = build_model_registry()
        self.assertIn('doubao-seed-2-1-turbo', reg)
    def test_qwen35_vision_capable(self):
        reg = build_model_registry()
        self.assertTrue(reg['qwen3.5:9b']['vision_capable'])
    def test_non_vision_excluded(self):
        ids = [m['id'] for m in get_vision_chain()]
        self.assertNotIn('deepseek-r1:7b', ids)
        self.assertNotIn('qwen2.5:7b', ids)
    def test_flux_real_id(self):
        reg = build_model_registry()
        self.assertIn('x/flux2-klein:4b-fp4', reg)
    def test_qwen35_context_config(self):
        info = LOCAL_MODELS['qwen3.5:9b']
        self.assertEqual(info['context_default'], 8192)
        self.assertEqual(info['context_long'], 16384)
        self.assertEqual(info['context_max'], 32768)
    def test_embedding_fixed(self):
        from model_registry import EMBEDDING_MODEL_ID
        self.assertEqual(EMBEDDING_MODEL_ID, 'nomic-embed-text:latest')

class T8ErrorDetail(unittest.TestCase):
    """恢复 f2053c1 的错误分类详细测试"""
    def test_408(self): self.assertTrue(_classify_error(Exception("t"),408)[0])
    def test_429(self): self.assertTrue(_classify_error(Exception("t"),429)[0])
    def test_500(self): self.assertTrue(_classify_error(Exception("t"),500)[0])
    def test_502(self): self.assertTrue(_classify_error(Exception("t"),502)[0])
    def test_504(self): self.assertTrue(_classify_error(Exception("t"),504)[0])
    def test_timeout(self):
        import requests
        self.assertTrue(_classify_error(requests.exceptions.Timeout())[0])
    def test_connection_error(self):
        import requests
        self.assertTrue(_classify_error(requests.exceptions.ConnectionError())[0])
    def test_content_rejection(self):
        self.assertFalse(_classify_error(Exception("content filter rejected"))[0])

class T7HealthManager(unittest.TestCase):
    """恢复 f2053c1 的健康状态管理器测试"""
    def setUp(self): health._states={}
    def test_429_first_cooldown(self):
        health.set_status('m', HEALTH_RATE_LIMITED, error="429")
        s = health.get_status('m')
        self.assertGreater(s['cooldown_remaining'], 55)
    def test_429_second_cooldown(self):
        health.set_status('m', HEALTH_RATE_LIMITED, error="1")
        health.set_status('m', HEALTH_RATE_LIMITED, error="2")
        s = health.get_status('m')
        self.assertGreater(s['cooldown_remaining'], 295)
    def test_available_resets(self):
        health.set_status('m', HEALTH_RATE_LIMITED, error="429")
        health.set_status('m', HEALTH_AVAILABLE, elapsed=1.0)
        s = health.get_status('m')
        self.assertEqual(s['cooldown_remaining'], 0)
    def test_rate_limited_not_available(self):
        health.set_status('m', HEALTH_RATE_LIMITED, error="429")
        self.assertFalse(health.is_available('m'))
    def test_config_error_never_available(self):
        health.set_status('m', HEALTH_CONFIG_ERROR, error="401")
        self.assertFalse(health.is_available('m'))
    def test_429_not_permanent(self):
        health.set_status('glm-4.6v-flash', HEALTH_RATE_LIMITED, error="429")
        health._states['glm-4.6v-flash']['cooldown_until'] = time.time() - 1
        self.assertTrue(health.is_available('glm-4.6v-flash'))


class T2Glm47to4(unittest.TestCase):
    def setUp(self): health._states={}; self.c=AIClient()
    @patch('ai_client.requests.post')
    def test(self, mp):
        ms=[]
        def se(u,**k):
            m=k.get('json',{}).get('model',''); ms.append(m); r=MagicMock()
            if 'glm-4.7' in m: r.status_code=500; r.text='e'
            else: r.status_code=200; r.json.return_value={"choices":[{"message":{"content":"GLM4"}}],"usage":{}}
            return r
        mp.side_effect=se
        self.assertIn("GLM4", self.c.chat("hi",task_name="t2"))
        self.assertIn('glm-4.7-flash',ms); self.assertIn('glm-4-flash',ms)

class T3GlmToQwen35(unittest.TestCase):
    def setUp(self): health._states={}; self.c=AIClient()
    @patch('ai_client.requests.post')
    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test(self, mlp, mlg, map_):
        mlg.side_effect=MockPs("qwen3.5:9b"); mlp.return_value=_p_ok()
        def se(u,**k):
            r=MagicMock()
            if 'localhost' in u or '11434' in u:
                r.status_code=200; r.json.return_value={"message":{"content":"qwen35"},"eval_count":5}
            else: r.status_code=503; r.text='e'
            return r
        map_.side_effect=se
        self.assertIn("qwen35", self.c.chat("hi",task_name="t3"))

class T4CloudToQwen35(unittest.TestCase):
    def setUp(self): health._states={}; self.c=AIClient()
    @patch('ai_client.requests.post')
    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test(self, mlp, mlg, map_):
        mlg.side_effect=MockPs("qwen3.5:9b"); mlp.return_value=_p_ok()
        def se(u,**k):
            r=MagicMock()
            if 'localhost' in u or '11434' in u: r.status_code=200; r.json.return_value={"message":{"content":"qwen35"},"eval_count":5}
            else: r.status_code=503; r.text='e'
            return r
        map_.side_effect=se
        self.assertIn("qwen35", self.c.chat("hi",task_name="t4"))

class T5Qwen35ToQwen25(unittest.TestCase):
    def setUp(self): health._states={}; self.c=AIClient()
    @patch('ai_client.requests.post')
    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test(self, mlp, mlg, map_):
        mlg.side_effect=MockPs("qwen2.5:7b"); mlp.return_value=_p_ok()
        def se(u,**k):
            m=k.get('json',{}).get('model',''); r=MagicMock()
            if 'localhost' in u or '11434' in u:
                if 'qwen3.5' in m: r.status_code=500; r.text='e'
                elif m=='qwen2.5:7b': r.status_code=200; r.json.return_value={"message":{"content":"qwen25"},"eval_count":5}
                else: r.status_code=500; r.text='e'
            else: r.status_code=503; r.text='e'
            return r
        map_.side_effect=se
        self.assertIn("qwen25", self.c.chat("hi",task_name="t5"))

class T8NoFailover(unittest.TestCase):
    def setUp(self): health._states={}; self.c=AIClient()
    @patch('ai_client.requests.post')
    def test_401(self, mp):
        r=MagicMock(); r.status_code=401; r.text="Unauthorized"; mp.return_value=r
        self.c.chat("hi",task_name="t8a"); self.assertEqual(mp.call_count,1)
    @patch('ai_client.requests.post')
    def test_403(self, mp):
        r=MagicMock(); r.status_code=403; r.text="Forbidden"; mp.return_value=r
        self.c.chat("hi",task_name="t8b"); self.assertEqual(mp.call_count,1)
    def test_classify(self):
        for c in [401,403,400]: self.assertFalse(_classify_error(Exception(f"HTTP {c}"),c)[0])
        for c in [408,429,500,502,503,504]: self.assertTrue(_classify_error(Exception(f"HTTP {c}"),c)[0])
    def test_empty(self): self.assertIn("输入为空", self.c.chat("",task_name="t8c"))

class T9Vision429(unittest.TestCase):
    def setUp(self): health._states={}; self.c=AIClient()
    @patch('ai_client.requests.post')
    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test(self, mlp, mlg, map_):
        mlg.side_effect=MockPs("qwen3.5:9b"); mlp.return_value=_p_ok()
        def se(u,**k):
            m=k.get('json',{}).get('model',''); r=MagicMock()
            if 'glm-4.6v' in m: r.status_code=429; r.text="RL"
            elif 'localhost' in u or '11434' in u: r.status_code=200; r.json.return_value={"message":{"content":"localvis"},"eval_count":5}
            else: r.status_code=500; r.text='e'
            return r
        map_.side_effect=se
        self.assertIn("localvis", self.c.chat_with_image("data:image/png;base64,abc","d",task_name="t9"))

class T10CogviewToFlux(unittest.TestCase):
    def setUp(self): health._states={}; self.c=AIClient()
    @patch('ai_client.requests.post')
    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test(self, mlp, mlg, map_):
        mlg.side_effect=MockPs("x/flux2-klein:4b-fp4"); mlp.return_value=_p_ok()
        import base64
        def se(u,**k):
            r=MagicMock()
            if 'images/generations' in u: r.status_code=500; r.text='e'
            elif '/api/generate' in u: r.status_code=200; r.json.return_value={"images":[base64.b64encode(b"\x89PNG").decode()]}
            else: r.status_code=200; r.json.return_value={}
            return r
        map_.side_effect=se
        res=self.c.generate_image("cat",task_name="t10")
        self.assertTrue(res['success']); self.assertIn('FLUX',res['model'])

class T11ManualFlux(unittest.TestCase):
    def setUp(self): health._states={}; self.c=AIClient()
    @patch('ai_client.requests.post')
    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test(self, mlp, mlg, map_):
        mlg.side_effect=MockPs("x/flux2-klein:4b-fp4"); mlp.return_value=_p_ok()
        import base64; urls=[]
        def se(u,**k):
            urls.append(u); r=MagicMock()
            if '/api/generate' in u: r.status_code=200; r.json.return_value={"images":[base64.b64encode(b"\x89PNG").decode()]}
            else: r.status_code=200; r.json.return_value={}
            return r
        map_.side_effect=se
        res=self.c.generate_image("cat",task_name="t11",manual_model="x/flux2-klein:4b-fp4")
        self.assertTrue(res['success'])
        self.assertEqual(len([u for u in urls if 'images/generations' in u]),0)

class T12Concurrent(unittest.TestCase):
    def setUp(self):
        local_model_manager._global_lock=threading.Lock()
        local_model_manager._active_model=None; local_model_manager._owned_models=set(); local_model_manager._preload_ok=False
    @patch.object(LocalModelManager,'_wait_until_loaded',return_value=True)
    @patch.object(LocalModelManager,'_wait_until_unloaded',return_value=True)
    @patch.object(LocalModelManager,'_preload_model',return_value=True)
    @patch.object(LocalModelManager,'_unload_model',return_value=True)
    @patch.object(LocalModelManager,'_get_running_large_model',return_value=None)
    def test(self, *mocks):
        cc=[0]; mx=[0]; lk=threading.Lock()
        def task(mid):
            if local_model_manager.acquire(mid,timeout=10):
                with lk: cc[0]+=1; mx[0]=max(mx[0],cc[0])
                time.sleep(0.15)
                with lk: cc[0]-=1
                local_model_manager.release(mid)
        ts=[threading.Thread(target=task,args=(m,)) for m in ["qwen3.5:9b","deepseek-r1:7b","qwen2.5:7b"]]
        for t in ts: t.start()
        for t in ts: t.join(timeout=30)
        self.assertEqual(mx[0],1)

class T13OldUnloaded(unittest.TestCase):
    def setUp(self):
        local_model_manager._global_lock=threading.Lock()
        local_model_manager._active_model=None; local_model_manager._owned_models=set(); local_model_manager._preload_ok=False
    @patch('local_model_manager.requests.post')
    @patch('local_model_manager.requests.get')
    def test_unload_first(self, mg, mp):
        seq=[{"models":[{"name":"qwen3.5:9b"}]},{"models":[]},{"models":[{"name":"deepseek-r1:7b"}]},{"models":[]}]
        idx=[0]
        def pse(u,**k):
            r=MagicMock(); r.status_code=200
            r.json.return_value=seq[idx[0]] if idx[0]<len(seq) else {"models":[]}; idx[0]+=1; return r
        mg.side_effect=pse; mp.return_value=_p_ok()
        local_model_manager._owned_models.add("qwen3.5:9b")
        ok=local_model_manager.acquire("deepseek-r1:7b",timeout=5)
        self.assertTrue(ok, local_model_manager.last_error)
        uc=[c for c in mp.call_args_list if c.kwargs.get('json',{}).get('keep_alive')==0 and 'qwen3.5' in str(c.kwargs.get('json',{}).get('model',''))]
        self.assertGreater(len(uc),0)
        local_model_manager.release("deepseek-r1:7b")
    @patch('local_model_manager.requests.post')
    @patch('local_model_manager.requests.get')
    def test_unload_fail_blocks(self, mg, mp):
        mg.return_value=MagicMock(status_code=200,json=lambda:{"models":[{"name":"qwen3.5:9b"}]})
        mp.return_value=_p_ok()
        local_model_manager._owned_models.add("qwen3.5:9b")
        ok=local_model_manager.acquire("deepseek-r1:7b",timeout=5)
        self.assertFalse(ok); self.assertIsNotNone(local_model_manager.last_error)

class T14PreloadConfirmed(unittest.TestCase):
    def setUp(self):
        local_model_manager._global_lock=threading.Lock()
        local_model_manager._active_model=None; local_model_manager._owned_models=set(); local_model_manager._preload_ok=False
    @patch('local_model_manager.requests.post')
    @patch('local_model_manager.requests.get')
    def test(self, mg, mp):
        seq=[{"models":[]},{"models":[]},{"models":[{"name":"qwen3.5:9b"}]},{"models":[]}]
        idx=[0]
        def pse(u,**k):
            r=MagicMock(); r.status_code=200
            r.json.return_value=seq[idx[0]] if idx[0]<len(seq) else {"models":[]}; idx[0]+=1; return r
        mg.side_effect=pse; mp.return_value=_p_preload()
        ok=local_model_manager.acquire("qwen3.5:9b",timeout=5)
        self.assertTrue(ok); self.assertTrue(local_model_manager._preload_ok)
        pc=[c for c in mp.call_args_list if c.kwargs.get('json',{}).get('keep_alive')=='5m']
        self.assertGreater(len(pc),0)
        local_model_manager.release("qwen3.5:9b")

class T15NoResidual(unittest.TestCase):
    def setUp(self):
        local_model_manager._global_lock=threading.Lock()
        local_model_manager._active_model=None; local_model_manager._owned_models=set(); local_model_manager._preload_ok=False
    @patch('local_model_manager.requests.post')
    @patch('local_model_manager.requests.get')
    def test_clean(self, mg, mp):
        seq=[{"models":[]},{"models":[{"name":"qwen3.5:9b"}]},{"models":[]}]
        idx=[0]
        def pse(u,**k):
            r=MagicMock(); r.status_code=200
            r.json.return_value=seq[idx[0]] if idx[0]<len(seq) else {"models":[]}; idx[0]+=1; return r
        mg.side_effect=pse; mp.return_value=_p_ok()
        local_model_manager.acquire("qwen3.5:9b",timeout=5)
        ok,err=local_model_manager.release("qwen3.5:9b")
        self.assertTrue(ok,err); self.assertIsNone(local_model_manager._active_model)
    @patch('local_model_manager.requests.post')
    @patch('local_model_manager.requests.get')
    def test_reports_fail(self, mg, mp):
        seq=[{"models":[]},{"models":[{"name":"qwen3.5:9b"}]},{"models":[{"name":"qwen3.5:9b"}]}]
        idx=[0]
        def pse(u,**k):
            r=MagicMock(); r.status_code=200
            r.json.return_value=seq[idx[0]] if idx[0]<len(seq) else {"models":[{"name":"qwen3.5:9b"}]}; idx[0]+=1; return r
        mg.side_effect=pse; mp.return_value=_p_ok()
        local_model_manager.acquire("qwen3.5:9b",timeout=5)
        ok,err=local_model_manager.release("qwen3.5:9b")
        self.assertFalse(ok); self.assertIsNotNone(err)

class T16TraceNoSecrets(unittest.TestCase):
    def setUp(self): health._states={}; self.c=AIClient()
    @patch('ai_client.requests.post')
    def test_no_secrets(self, mp):
        r=MagicMock(); r.status_code=200
        r.json.return_value={"choices":[{"message":{"content":"ok"}}],"usage":{}}
        mp.return_value=r
        self.c.chat("test",task_name="t16")
        s=json.dumps(self.c.last_trace,ensure_ascii=False)
        for bad in ["sk-","ark-","Bearer ","password","api_key",'"token":']:
            self.assertNotIn(bad,s,f"不应包含: {bad}")
    @patch('ai_client.requests.post')
    def test_failover_details(self, mp):
        cnt=[0]
        def se(u,**k):
            cnt[0]+=1; r=MagicMock()
            if cnt[0]==1: r.status_code=503; r.text='e'
            else: r.status_code=200; r.json.return_value={"choices":[{"message":{"content":"ok"}}],"usage":{}}
            return r
        mp.side_effect=se
        self.c.chat("test",task_name="t16b")
        t=self.c.last_trace
        self.assertGreater(len(t.get('failover_details',[])),0)
        for key in ['from','to','type','status_code','reason','elapsed','mode']:
            self.assertIn(key,t['failover_details'][0])

class TP11Chains(unittest.TestCase):
    def test_text_7(self):
        self.assertEqual([m['id'] for m in get_text_chain()],
            ['glm-4.7-flash','glm-4-flash','doubao-seed-2-1-turbo','qwen3.5:9b','deepseek-r1:7b','qwen2.5:7b','qwen2.5vl:7b'])
    def test_local_text_4(self):
        from model_registry import get_local_text_chain
        self.assertEqual([m['id'] for m in get_local_text_chain()],
            ['qwen3.5:9b','deepseek-r1:7b','qwen2.5:7b','qwen2.5vl:7b'])
    def test_reasoning(self):
        from model_registry import get_reasoning_chain
        self.assertEqual([m['id'] for m in get_reasoning_chain()], ['glm-4.7-flash','qwen3.5:9b','deepseek-r1:7b'])
    def test_vision(self): self.assertEqual([m['id'] for m in get_vision_chain()], ['glm-4.6v-flash','qwen3.5:9b','qwen2.5vl:7b'])
    def test_image_filters_runtime_unsupported(self):
        # FLUX运行时不支持时，图像链只含CogView
        from model_registry import check_ollama_image_gen_support, HEALTH_RUNTIME_UNSUPPORTED
        ok, _ = check_ollama_image_gen_support()
        chain_ids = [m['id'] for m in get_image_chain()]
        self.assertIn('cogview-3-flash', chain_ids)
        if not ok:
            self.assertNotIn('x/flux2-klein:4b-fp4', chain_ids)
            s = health.get_status('x/flux2-klein:4b-fp4')
            self.assertEqual(s['status'], HEALTH_RUNTIME_UNSUPPORTED)

class TP11ImageManual(unittest.TestCase):
    def setUp(self): health._states={}; self.c=AIClient(); self.c.manual_image_model=None
    @patch('ai_client.requests.post')
    def test_explicit_auto_overrides(self, mp):
        self.c.manual_image_model="x/flux2-klein:4b-fp4"
        mp.return_value=MagicMock(status_code=200,json=lambda:{"data":[{"url":"https://example.com/t.png"}]})
        r=self.c.generate_image("cat",task_name="p11b",manual_model="auto")
        self.assertTrue(r['success']); self.assertIn('CogView',r['model'])
    @patch('ai_client.requests.post')
    def test_manual_cogview_no_flux(self, mp):
        cnt=[0]
        def se(u,**k): cnt[0]+=1; r=MagicMock(); r.status_code=500; r.text='e'; return r
        mp.side_effect=se
        r=self.c.generate_image("cat",task_name="p11d",manual_model="cogview-3-flash")
        self.assertFalse(r['success']); self.assertEqual(cnt[0],1)

class TP11LocalOwnership(unittest.TestCase):
    def setUp(self):
        local_model_manager._global_lock=threading.Lock(); local_model_manager._active_model=None
        local_model_manager._owned_models=set(); local_model_manager._preload_ok=False
    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test_external_not_unloaded(self, mp, mg):
        mg.return_value=MagicMock(status_code=200,json=lambda:{"models":[{"name":"ext:7b"}]})
        mp.return_value=_p_ok()
        with patch('local_model_manager.OLLAMA_EXTERNAL_WAIT_MAX',2):
            ok=local_model_manager.acquire("qwen3.5:9b",timeout=5)
        self.assertFalse(ok)
        uc=[c for c in mp.call_args_list if c.kwargs.get('json',{}).get('keep_alive')==0]
        self.assertEqual(len(uc),0)
    @patch('local_model_manager.requests.get')
    def test_embedding_not_large(self, mg):
        mg.return_value=MagicMock(status_code=200,json=lambda:{"models":[{"name":"nomic-embed-text:latest"}]})
        self.assertIsNone(local_model_manager._get_running_large_model())

class TP11SlowResponse(unittest.TestCase):
    def setUp(self):
        health._states={}
        import ai_client; ai_client._slow_response_tracker={}
    def test_single_30s_recorded(self):
        import ai_client
        r=ai_client._is_slow_response("glm-4.7-flash",35.0)
        self.assertIn("glm-4.7-flash", ai_client._slow_response_tracker)
    def test_consecutive_15s_triggers(self):
        import ai_client
        self.assertFalse(ai_client._is_slow_response("glm-4.7-flash",16.0))
        self.assertTrue(ai_client._is_slow_response("glm-4.7-flash",18.0))
    def test_no_failover_codes(self):
        for c in [401,403,400,422]: self.assertFalse(_classify_error(Exception("t"),c)[0])
    def test_can_failover_codes(self):
        for c in [429,408,500,502,503]: self.assertTrue(_classify_error(Exception("t"),c)[0])


class TP113EndToEndSlowFailover(unittest.TestCase):
    """P1.1.3 慢响应自动故障转移端到端测试"""
    def setUp(self):
        health._states={}
        import ai_client; ai_client._slow_response_tracker={}
        self.c=AIClient()

    @patch('ai_client.requests.post')
    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test_single_slow_30s_triggers_qwen35_next(self, mlp, mlg, map_):
        """单次>30秒慢响应后，下一次自动调用首先进入qwen3.5:9b"""
        mlg.side_effect=MockPs("qwen3.5:9b"); mlp.return_value=_p_ok()
        call_order=[]
        def se(u,**k):
            m=k.get('json',{}).get('model','')
            r=MagicMock()
            if 'localhost' in u or '11434' in u:
                call_order.append(m)
                r.status_code=200; r.json.return_value={"message":{"content":"qwen35_result"},"eval_count":5}
            elif 'glm-4.7' in m:
                call_order.append(m)
                import time as _t; _t.sleep(0.001)
                r.status_code=200; r.json.return_value={"choices":[{"message":{"content":"slow_glm_result"}}],"usage":{}}
                # 模拟耗时35秒
                k['json']['_mock_elapsed']=35.0
            else:
                r.status_code=503; r.text='e'
            return r
        map_.side_effect=se
        # 第一次调用：glm-4.7 慢响应（mock time）
        with patch('ai_client.time.time') as mock_time:
            start=[0.0]
            def fake_time():
                start[0]+=0.001
                if len(call_order)==1 and 'glm' in call_order[-1]:
                    return start[0]+35.0
                return start[0]
            mock_time.side_effect=fake_time
            r1=self.c.chat("hi",task_name="p113a")
        self.assertIn("slow_glm_result", r1)
        # 第二次调用：应该跳过glm-4.7，直接进入qwen3.5
        call_order.clear()
        r2=self.c.chat("hi2",task_name="p113b")
        self.assertIn("qwen35_result", r2)
        self.assertEqual(call_order[0], "qwen3.5:9b")

    @patch('ai_client.requests.post')
    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test_consecutive_15s_triggers_qwen35(self, mlp, mlg, map_):
        """连续两次>15秒后，下一次自动调用首先进入qwen3.5:9b"""
        mlg.side_effect=MockPs("qwen3.5:9b"); mlp.return_value=_p_ok()
        call_order=[]
        def se(u,**k):
            m=k.get('json',{}).get('model','')
            r=MagicMock()
            if 'localhost' in u or '11434' in u:
                call_order.append(m)
                r.status_code=200; r.json.return_value={"message":{"content":"qwen35_result"},"eval_count":5}
            elif 'glm-4.7' in m:
                call_order.append(m)
                r.status_code=200; r.json.return_value={"choices":[{"message":{"content":"glm_result"}}],"usage":{}}
            else:
                r.status_code=503; r.text='e'
            return r
        map_.side_effect=se
        # 模拟两次慢响应
        import ai_client
        ai_client._is_slow_response("glm-4.7-flash", 18.0)
        ai_client._is_slow_response("glm-4.7-flash", 20.0)
        # 下一次调用应该跳过glm-4.7
        call_order.clear()
        r=self.c.chat("hi",task_name="p113c")
        self.assertIn("qwen35_result", r)
        self.assertEqual(call_order[0], "qwen3.5:9b")

    @patch('ai_client.requests.post')
    def test_manual_glm_not_switched_on_slow(self, mp):
        """手动选择glm-4.7时，即使慢响应也不自动切换"""
        import ai_client; ai_client._slow_response_tracker={}
        call_count=[0]
        def se(u,**k):
            call_count[0]+=1
            r=MagicMock()
            r.status_code=200; r.json.return_value={"choices":[{"message":{"content":"manual_glm"}}],"usage":{}}
            return r
        mp.side_effect=se
        # 先记录慢响应状态
        ai_client._is_slow_response("glm-4.7-flash", 35.0)
        # 手动选择glm-4.7
        r=self.c.chat("hi",task_name="p113d",manual_model="glm-4.7-flash")
        self.assertIn("manual_glm", r)
        self.assertEqual(call_count[0], 1)

    @patch('ai_client.requests.post')
    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test_trace_contains_slow_response_detail(self, mlp, mlg, map_):
        """Trace的failover_details包含slow_response原因"""
        mlg.side_effect=MockPs("qwen3.5:9b"); mlp.return_value=_p_ok()
        def se(u,**k):
            r=MagicMock()
            if 'localhost' in u or '11434' in u:
                r.status_code=200; r.json.return_value={"message":{"content":"qwen35"},"eval_count":5}
            else:
                r.status_code=200; r.json.return_value={"choices":[{"message":{"content":"glm"}}],"usage":{}}
            return r
        map_.side_effect=se
        import ai_client
        ai_client._is_slow_response("glm-4.7-flash", 35.0)
        # 触发chat并获取last_trace
        self.c.chat("hi",task_name="p113e")
        # 检查last_trace中的failover_details包含slow_response
        self.assertIsNotNone(self.c.last_trace)
        details = self.c.last_trace.get("failover_details", [])
        found_slow = any(d.get("reason")=="slow_response" for d in details)
        self.assertTrue(found_slow, "Trace中未找到slow_response原因")


class TP12FluxRuntime(unittest.TestCase):
    """FLUX运行时能力检测"""
    def setUp(self):
        import model_registry
        model_registry._ollama_image_gen_capable = None
        model_registry._ollama_image_gen_checked = False
        health._states = {}
    @patch('model_registry.requests.post')
    def test_runtime_unsupported_detected(self, mp):
        mp.return_value = MagicMock(status_code=400, text='{"error":"image generation models are not currently supported"}')
        ok, reason = check_ollama_image_gen_support(force=True)
        self.assertFalse(ok)
        self.assertIn('不支持', reason)
    @patch('model_registry.requests.post')
    def test_runtime_supported_detected(self, mp):
        mp.return_value = MagicMock(status_code=200, json=lambda:{"response":"ok"})
        ok, reason = check_ollama_image_gen_support(force=True)
        self.assertTrue(ok)
    @patch('model_registry.requests.post')
    def test_unsupported_marks_health(self, mp):
        from model_registry import HEALTH_RUNTIME_UNSUPPORTED
        mp.return_value = MagicMock(status_code=400, text='image generation models are not currently supported')
        chain = get_image_chain()
        ids = [m['id'] for m in chain]
        self.assertNotIn('x/flux2-klein:4b-fp4', ids)
        s = health.get_status('x/flux2-klein:4b-fp4')
        self.assertEqual(s['status'], HEALTH_RUNTIME_UNSUPPORTED)
    @patch('model_registry.requests.post')
    def test_is_available_false_for_runtime_unsupported(self, mp):
        from model_registry import HEALTH_RUNTIME_UNSUPPORTED
        health.set_status('x/flux2-klein:4b-fp4', HEALTH_RUNTIME_UNSUPPORTED)
        self.assertFalse(health.is_available('x/flux2-klein:4b-fp4'))

class TP13CogViewEndpoint(unittest.TestCase):
    """CogView健康检查使用真实/images/generations接口"""
    @patch('ai_client.requests.post')
    def test_cogview_uses_images_generations(self, mp):
        c = AIClient()
        c.manual_image_model = None
        mp.return_value = MagicMock(status_code=200, json=lambda:{"data":[{"url":"https://example.com/t.png"}]})
        r = c.generate_image("cat", task_name="cogview_test")
        # 验证调用了/images/generations而非/chat/completions
        called_urls = [str(call.kwargs.get('url','') or call[0][0] if call[0] else '') for call in mp.call_args_list]
        has_images_endpoint = any('images/generations' in u for u in called_urls)
        self.assertTrue(has_images_endpoint, f"未调用/images/generations，实际调用: {called_urls}")
    @patch('ai_client.requests.post')
    def test_cogview_402_balance(self, mp):
        from model_registry import HEALTH_INSUFFICIENT_BALANCE
        mp.return_value = MagicMock(status_code=402, text='insufficient balance')
        c = AIClient()
        c.manual_image_model = "cogview-3-flash"
        r = c.generate_image("cat", task_name="balance_test")
        self.assertFalse(r['success'])

class TP14LocalOwnershipExtended(unittest.TestCase):
    """本地模型所有权扩展测试"""
    def setUp(self):
        local_model_manager._global_lock = threading.Lock()
        local_model_manager._active_model = None
        local_model_manager._owned_models = set()
        local_model_manager._preload_ok = False
    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test_external_other_model_not_unloaded(self, mp, mg):
        """外部程序加载了其他模型，工作台不会卸载它"""
        mg.return_value = MagicMock(status_code=200, json=lambda:{"models":[{"name":"ext-other:7b"}]})
        mp.return_value = _p_ok()
        with patch('local_model_manager.OLLAMA_EXTERNAL_WAIT_MAX', 2):
            ok = local_model_manager.acquire("qwen3.5:9b", timeout=5)
        self.assertFalse(ok)
        # 确认没有发送keep_alive:0卸载外部模型
        unload_calls = [c for c in mp.call_args_list if c.kwargs.get('json',{}).get('keep_alive') == 0]
        self.assertEqual(len(unload_calls), 0)
    @patch('local_model_manager.requests.get')
    @patch('local_model_manager.requests.post')
    def test_owned_model_unloaded_on_release(self, mp, mg):
        """工作台自己加载的模型，release时正常卸载"""
        mg.return_value = MagicMock(status_code=200, json=lambda:{"models":[]})
        mp.return_value = _p_ok()
        ok = local_model_manager.acquire("qwen3.5:9b", timeout=10)
        self.assertTrue(ok)
        self.assertIn("qwen3.5:9b", local_model_manager._owned_models)
        # release应发送keep_alive:0
        rel_ok, _ = local_model_manager.release("qwen3.5:9b")
        unload_calls = [c for c in mp.call_args_list if c.kwargs.get('json',{}).get('keep_alive') == 0]
        self.assertGreaterEqual(len(unload_calls), 1)

class TIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import requests
            cls.ok=requests.get("http://localhost:11434/api/tags",timeout=5).status_code==200
        except: cls.ok=False
    def test_models(self):
        if not self.ok: self.skipTest("Ollama未运行")
        import requests
        ms=[m['name'] for m in requests.get("http://localhost:11434/api/tags",timeout=10).json().get('models',[])]
        for e in ['qwen3.5:9b','deepseek-r1:7b','qwen2.5:7b','qwen2.5vl:7b','x/flux2-klein:4b-fp4','nomic-embed-text:latest']:
            self.assertIn(e,ms,f"缺失: {e}")
    def test_qwen35_vision(self):
        self.assertTrue(build_model_registry()['qwen3.5:9b']['vision_capable'])

def run_all():
    loader=unittest.TestLoader(); suite=unittest.TestSuite()
    for c in [T1Chain,T1RegistryDetail,T7HealthManager,T2Glm47to4,T3GlmToQwen35,T4CloudToQwen35,
              T5Qwen35ToQwen25,T8NoFailover,T8ErrorDetail,T9Vision429,T10CogviewToFlux,
              T11ManualFlux,T12Concurrent,T13OldUnloaded,T14PreloadConfirmed,T15NoResidual,
              T16TraceNoSecrets,TIntegration,TP11Chains,TP11ImageManual,TP11LocalOwnership,
              TP11SlowResponse,TP113EndToEndSlowFailover,TP12FluxRuntime,TP13CogViewEndpoint,
              TP14LocalOwnershipExtended]:
        suite.addTests(loader.loadTestsFromTestCase(c))
    r=unittest.TextTestRunner(verbosity=2).run(suite)
    print("\n"+"="*60)
    p=r.testsRun-len(r.failures)-len(r.errors)
    print(f"总数:{r.testsRun} 通过:{p} 失败:{len(r.failures)} 错误:{len(r.errors)}")
    if r.failures:
        print("\n--- 失败 ---")
        for t,tb in r.failures: print(f"FAIL:{t}\n{tb[:500]}")
    if r.errors:
        print("\n--- 错误 ---")
        for t,tb in r.errors: print(f"ERROR:{t}\n{tb[:500]}")
    print("="*60)
    return r.wasSuccessful()

if __name__=="__main__": sys.exit(0 if run_all() else 1)
