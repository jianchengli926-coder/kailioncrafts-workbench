"""飞书API连接模块"""
import requests
import json
from pathlib import Path

APP_ID = "cli_aa2c7e3b30b8dbd8"
APP_SECRET = "aCf98A3ZoAf16ncmBhy8lbkBxYbUwJU6"
BASE = "https://open.feishu.cn/open-apis"
WORKBENCH_FOLDER_TOKEN = "GqPhfXFuwlFg6odSYCGc5oYsntB"
WORKBENCH_FOLDER_URL = "https://ucnjqdvqgy2x.feishu.cn/drive/folder/GqPhfXFuwlFg6odSYCGc5oYsntB"
WORKBENCH_FOLDER_NAME = "KaiLionCrafts工作台"

_token_cache = {"token": None, "expire": 0}

def get_token():
    import time
    if _token_cache["token"] and time.time() < _token_cache["expire"] - 60:
        return _token_cache["token"]
    r = requests.post(f"{BASE}/auth/v3/tenant_access_token/internal",
        json={"app_id": APP_ID, "app_secret": APP_SECRET}, timeout=10)
    data = r.json()
    _token_cache["token"] = data["tenant_access_token"]
    _token_cache["expire"] = time.time() + data.get("expire", 7200)
    return _token_cache["token"]

def api_get(path, params=None):
    r = requests.get(f"{BASE}{path}", headers={"Authorization": f"Bearer {get_token()}"},
        params=params or {}, timeout=15)
    return r.json()

def api_post(path, body=None):
    r = requests.post(f"{BASE}{path}", headers={"Authorization": f"Bearer {get_token()}", "Content-Type": "application/json"},
        json=body or {}, timeout=15)
    return r.json()

def list_drive_files(folder_token=None):
    """列云盘文件"""
    params = {"page_size": 50}
    if folder_token:
        params["folder_token"] = folder_token
    return api_get("/drive/v1/files", params)

def create_folder(name, parent_token=None):
    """创建文件夹"""
    body = {"name": name, "folder_token": parent_token or ""}
    return api_post("/drive/v1/files/create_folder", body)

def get_bot_info():
    """机器人信息"""
    return api_get("/bot/v3/info")

def send_text_message(chat_id, text):
    """发送文本消息到指定群聊"""
    body = {
        "receive_id": chat_id,
        "msg_type": "text",
        "content": json.dumps({"text": text})
    }
    return api_post(f"/im/v1/messages?receive_id_type=chat_id", body)

def list_bases():
    """列多维表格"""
    return api_get("/bitable/v1/apps", {"page_size": 20})

def test_connection():
    """测试连接，返回各项状态"""
    results = {}
    try:
        tok = get_token()
        results["token"] = "✅ 成功" if tok else "❌ 失败"
    except Exception as e:
        results["token"] = f"❌ {e}"
    try:
        d = list_drive_files()
        results["drive"] = f"✅ {len(d.get('data',{}).get('files',[]))}个文件"
    except Exception as e:
        results["drive"] = f"❌ {e}"
    try:
        b = get_bot_info()
        results["bot"] = "✅ 已启用" if b.get("code") == 0 else f"❌ {b.get('msg')}"
    except Exception as e:
        results["bot"] = f"❌ {e}"
    try:
        # 测试创建文档
        import requests
        token = get_token()
        r = requests.post(f"{BASE}/docx/v1/documents",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"folder_token": WORKBENCH_FOLDER_TOKEN, "title": "连接测试"}, timeout=10)
        results["doc"] = "✅ 可创建" if r.status_code == 200 and r.json().get("code") == 0 else "❌ 需权限"
    except Exception as e:
        results["doc"] = "❌ 需权限"
    return results

def create_doc(title, content=""):
    """在工作台文件夹创建飞书文档，同时本地存档"""
    # 1. 本地存档
    local_dir = Path("data/feishu_docs")
    local_dir.mkdir(parents=True, exist_ok=True)
    safe_title = "".join(c for c in title if c not in '/\\:*?"<>|')[:80]
    local_path = local_dir / f"{safe_title}.md"
    local_path.write_text(content, encoding="utf-8")

    # 2. 飞书存档
    token = get_token()
    r = requests.post(f"{BASE}/docx/v1/documents",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"folder_token": WORKBENCH_FOLDER_TOKEN, "title": title}, timeout=15)
    data = r.json()
    if data.get("code") == 0:
        doc_id = data["data"]["document"]["document_id"]
        if content:
            requests.patch(f"{BASE}/docx/v1/documents/{doc_id}/raw_content",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"content": content}, timeout=15)
        return {"success": True, "doc_id": doc_id, "url": f"https://ucnjqdvqgy2x.feishu.cn/docx/{doc_id}",
                "local_path": str(local_path)}
    return {"success": False, "error": data.get("msg"), "local_path": str(local_path)}

def list_local_docs():
    """列本地存档的文档"""
    local_dir = Path("data/feishu_docs")
    if not local_dir.exists():
        return []
    return sorted(local_dir.glob("*.md"), key=lambda x: x.stat().st_mtime, reverse=True)

def upload_html_report(title, html_content):
    """把HTML报告存为飞书文档"""
    result = create_doc(title, html_content)
    return result
