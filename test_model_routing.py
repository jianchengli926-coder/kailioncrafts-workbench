# -*- coding: utf-8 -*-
"""KaiLionCrafts AI工作台 - 模型路由测试套件 v2.0 - 覆盖全部16项验收标准"""
import sys, os, time, json, threading, unittest
from unittest.mock import patch, MagicMock
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from model_registry import (build_model_registry, get_text_chain, get_vision_chain,
    get_image_chain, get_local_text_chain, health, TEXT_CHAIN_IDS, VISION_CHAIN_IDS,
    IMAGE_CHAIN_IDS, DISABLED_ONLINE_PROVIDERS, LOCAL_MODELS)
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
    def test_text_4(self): self.assertEqual([m['id'] for m in get_text_chain()], ['glm-4.7-flash','glm-4-flash','qwen3.5:9b','qwen2.5:7b'])
    def test_reasoning(self):
        from model_registry import get_reasoning_chain
        self.assertEqual([m['id'] for m in get_reasoning_chain()], ['glm-4.7-flash','qwen3.5:9b','deepseek-r1:7b'])
    def test_vision(self): self.assertEqual([m['id'] for m in get_vision_chain()], ['glm-4.6v-flash','qwen3.5:9b','qwen2.5vl:7b'])
    def test_image(self): self.assertEqual([m['id'] for m in get_image_chain()], ['cogview-3-flash','x/flux2-klein:4b-fp4'])

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
    for c in [T1Chain,T2Glm47to4,T3GlmToQwen35,T4CloudToQwen35,T5Qwen35ToQwen25,
              T8NoFailover,T9Vision429,T10CogviewToFlux,
              T11ManualFlux,T12Concurrent,T13OldUnloaded,T14PreloadConfirmed,T15NoResidual,
              T16TraceNoSecrets,TIntegration,TP11Chains,TP11ImageManual,TP11LocalOwnership,TP11SlowResponse]:
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
