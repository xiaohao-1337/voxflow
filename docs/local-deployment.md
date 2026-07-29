# Local Deployment

VoxFlow 当前只支持回环地址上的单用户本地服务；启动入口会拒绝 `0.0.0.0` 和其他非 loopback host。

## 准备环境与模型

```bash
cd apps/local-ai-server
python3.11 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -e .
.venv/bin/python scripts/download_asr.py
.venv/bin/python scripts/download_mt.py
.venv/bin/python scripts/check_models.py
```

如果已经通过 Git LFS 拉取 `apps/models/mt`，可跳过 MT 下载。`check_models.py` 会检查必需配置、权重大小，并拒绝未拉取的 Git LFS pointer。

## 安全启动

开发环境可以直接绑定默认回环地址：

```bash
.venv/bin/python -m src.main
```

长期本地使用建议配置随机 Token，并将 Origin 收紧到实际扩展 ID：

```bash
export VOXFLOW_LOCAL_ENGINE_TOKEN='replace-with-a-long-random-token'
export VOXFLOW_ALLOWED_ORIGINS='chrome-extension://实际扩展ID'
.venv/bin/python -m src.main --host 127.0.0.1 --port 8765
```

在扩展 Options 中填写同一个 Token。不要把 Token 提交到仓库、命令日志或截图中。

## 验证

```bash
curl -H "Authorization: Bearer $VOXFLOW_LOCAL_ENGINE_TOKEN" \
  http://127.0.0.1:8765/health

.venv/bin/python scripts/realtime_client.py \
  --wav tmp/hello.wav \
  --stages asr,mt \
  --fast
```

`/health` 的 `status=ok` 表示 ASR/MT 文件完整；`modelState=cold|partial|ready` 表示当前进程中的模型加载状态。它不等于推理质量或性能测试。

## 当前边界

- 无 TLS、连接速率限制、系统服务安装器或自动更新。
- Token 需要手工生成并同步到扩展。
- 默认 Origin 规则允许浏览器扩展 scheme；生产安装应使用精确扩展 ID。
- 网关和 AI 推理更适合单用户本地运行。
