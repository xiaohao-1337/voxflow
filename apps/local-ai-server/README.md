# voxflow-local-engine

VoxFlow 本地 AI 服务，通过 `ws://127.0.0.1:8765/ws` 接收 PCM 音频并按 `voxflow.local.v1` 协议执行处理。

当前能力：

- FunASR `SenseVoiceSmall` 本地英文语音识别。
- MarianMT / OPUS-MT 英文到简体中文翻译。
- 支持 `asr` 和 `asr,mt` 两种管线。
- TTS 协议已预留，但推理引擎尚未实现。
- 标准库 asyncio WebSocket 网关，无额外 Web 框架依赖。
- `/health` 模型完整性、能力和冷/热加载状态。
- 浏览器 Origin 白名单与可选共享 Token。

## 安装

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -e .
```

模型目录：

```text
../../models/asr/SenseVoiceSmall
../../models/mt
```

如果 `../../models/mt` 不存在，服务会回退读取 `../models/mt` 中通过 Git LFS 拉取的模型。

下载翻译模型：

```bash
.venv/bin/python scripts/download_mt.py
```

下载 ASR 并检查所有模型：

```bash
.venv/bin/python scripts/download_asr.py
.venv/bin/python scripts/check_models.py
```

## 启动

```bash
.venv/bin/python -m src.main --host 127.0.0.1 --port 8765
```

可选安全配置：

```bash
export VOXFLOW_LOCAL_ENGINE_TOKEN='replace-with-a-long-random-token'
export VOXFLOW_ALLOWED_ORIGINS='chrome-extension://实际扩展ID'
.venv/bin/python -m src.main
```

启用后需在扩展 Options 中配置相同 Token。服务仍只应绑定回环地址。

## 终端测试

ASR + MT：

```bash
.venv/bin/python scripts/realtime_client.py \
  --wav tmp/hello.wav \
  --stages asr,mt
```

只做 ASR：

```bash
.venv/bin/python scripts/realtime_client.py --wav tmp/hello.wav --stages asr
```

使用 `--fast` 可跳过实时投喂等待，使用 `--verbose` 可打印音频统计和原始协议事件。

## 单元测试

```bash
.venv/bin/python -m unittest discover -s tests -v
```

完整协议参见 [docs/local-engine-protocol.md](../../docs/local-engine-protocol.md)。
