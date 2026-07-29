# Model Selection

本文只描述当前运行路径与下一阶段的选择标准，不代表所有目录中的 provider 已实现。

## 当前稳定组合

| 阶段 | 模型 / Runtime | 选择理由 | 当前限制 |
|---|---|---|---|
| ASR | FunASR SenseVoiceSmall | 本地部署成熟、英文识别链路已验证 | 当前按整段临时 WAV 推理，不输出 partial |
| MT | Helsinki-NLP/opus-mt-en-zh + MarianMT | 英译简中体积适中、可完全离线 | 只支持英文到简中，CPU 性能未量化 |
| TTS | 未选择 | 协议已预留 | Piper / CosyVoice provider 均未进入运行路径 |

服务当前只接受 `asr.provider=funasr` 和 `mt.provider=huggingface`。其他 provider 名称属于演进预留，请求时会明确失败。

## 模型文件验收

```bash
cd apps/local-ai-server
.venv/bin/python scripts/check_models.py
```

检查器验证必需配置、权重最小体积和 Git LFS pointer，但不替代真实推理测试。下载脚本：

```bash
.venv/bin/python scripts/download_asr.py
.venv/bin/python scripts/download_mt.py
```

## 后续评估标准

ASR 候选应比较英文固定集上的准确率、冷/热 RTF、内存、直接 waveform 输入、VAD/streaming 支持和 CPU/MPS/CUDA 一致性。

MT 候选应比较 chrF/BLEU、专有名词稳定性、长句截断、P50/P95 延迟和峰值 RSS。CTranslate2 INT8 只有在质量回归可接受且部署资产可复现时才应替换 MarianMT。

TTS 第一阶段优先评估 Piper：安装简单、CPU 可运行、可快速验证协议与播放器。CosyVoice 只有在硬件、首包延迟和模型许可满足本地产品边界时再作为高质量档位。
