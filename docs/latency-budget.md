# Latency Budget

当前版本尚未建立可重复的实测 P50/P95 数据，因此下面严格区分“结构性现状”和“优化目标”。

## 当前结构性延迟

```text
首条译文
≈ 句尾静音等待或最多 7 秒强制切段
 + ASR 冷/热推理
 + MT 冷/热推理
 + localhost 协议与 UI
```

浏览器侧已加入 240ms pre-roll、450ms 句尾静音和 7 秒连续语音上限。普通句子可以提前提交，但服务端仍是整段 ASR，能量启发式在噪声/音乐中也可能等到上限。`/health` 现在可以区分模型文件状态与 `cold | partial | ready` 加载状态，`engine.status` 可以标记加载和运行阶段，但尚未记录每个阶段耗时。

## 优化目标（非实测）

| 指标 | 下一阶段目标 |
|---|---:|
| 语音结束检测 | 300–800 ms |
| ASR 热推理 RTF | < 0.5 |
| MT 热推理 | < 500 ms |
| 首条中文文本 | < 3 s |
| 统计事件间隔 | 约 1 s |
| 待识别队列 | 最多 2 段 |

## 建议埋点

- 浏览器：`capture_started`、`segment_started`、`segment_ended`、`chunk_sent`、`result_received`。
- 服务：`chunk_received`、`asr_started/finished`、`mt_started/finished`。
- 统一使用单调时钟计算进程内耗时；Unix 时间只做跨进程关联。
- 冷启动单独记录，热启动至少连续 10 次并报告 P50/P95。

## 验收顺序

1. 固定 5s / 15s / 60s 英文测试音频和文本真值。
2. 记录当前静音启发式的句尾提交与 7 秒强制切段基线。
3. 接入模型 VAD 后比较首条延迟、分段质量和漏字。
4. 再评估 streaming ASR、二进制 PCM16 和模型量化，避免把网络微优化误当成端到端收益。
