# VoxFlow 性能优化建议

本文面向 VoxFlow 后续性能迭代，覆盖浏览器音频捕获、本地 WebSocket、FunASR、机器翻译、未来 TTS 与播放同步。建议先建立可重复的基线，再按优先级逐项优化，避免用局部微优化掩盖端到端延迟问题。

## 1. 当前性能基线

当前 MVP 的主要数据路径：

```text
48kHz 标签页音频
  -> AudioWorklet 线性降采样到 16kHz mono
  -> offscreen 缓冲约 7 秒
  -> 200ms Float32 PCM + JSON Base64 WebSocket
  -> 本地服务累积整段音频
  -> FunASR 离线段识别
  -> MarianMT 英译中
  -> 网页文本浮层
```

当前延迟的最大来源不是 WebSocket，而是“固定约 7 秒分段 + 整段 ASR”。即使模型推理速度很快，用户也需要先等待音频段收满。因此，降低首条译文延迟时，应优先改分段与 ASR 模式，而不是先调整网络参数。

已经具备的保护措施：

| 项目 | 当前实现 |
|---|---|
| 浏览器离线缓冲 | 最多保留约 12 秒，防止服务离线时内存无界增长 |
| 本地服务会话音频 | 最长 120 秒 |
| WebSocket 单帧 | 最大 2 MiB |
| AI 推理调度 | 放到工作线程，避免阻塞 asyncio 事件循环 |
| 模型实例 | ASR 与 MT 均缓存，避免每段重复加载 |
| 连接恢复 | 扩展断线后自动重连本地服务 |
| 协议校验 | 校验 session、stream、seq、Base64、字节数与帧数 |

## 2. 建议性能目标

下面是建议目标，不是当前实测数据。应分别记录冷启动和热启动结果，并至少统计 P50、P95。

| 指标 | MVP 优化目标 | 产品化目标 |
|---|---:|---:|
| AudioWorklet 单次处理 | < 1ms | < 0.5ms |
| 浏览器到本地服务传输抖动 | < 100ms | < 50ms |
| 语音结束检测 | 300-800ms | 200-500ms |
| ASR 热推理 RTF | < 0.5 | < 0.25 |
| 单句 MT 热推理 | < 500ms | < 200ms |
| 首条中文文本延迟 | < 3s | < 1.5s |
| TTS 首个音频分片 | < 1.2s | < 600ms |
| 连续运行内存增长 | 30 分钟后 < 10% | 2 小时后 < 10% |
| 音频队列积压 | < 2 个语音段 | 通常为 0-1 个语音段 |

RTF（Real-Time Factor）计算方式：

```text
RTF = 推理耗时 / 输入音频时长
```

RTF 小于 1 表示推理速度快于音频播放速度。

## 3. 先建立可重复测量

### 3.1 固定测试集

至少准备以下音频，每条保留文本真值：

- 5 秒、15 秒、60 秒英文清晰人声。
- 带背景音乐的英文视频音轨。
- 包含长静音、短停顿和连续快速语音的音频。
- 16kHz mono、48kHz stereo 两种输入。

测试时记录机器型号、CPU/GPU、内存、Python、PyTorch、FunASR 和 Transformers 版本。

### 3.2 统一时间戳

建议在协议事件中补充以下时间点，全部使用单调时钟计算耗时：

```text
capture_started
chunk_sent
chunk_received
vad_speech_started
vad_speech_ended
asr_started
asr_finished
mt_started
mt_finished
tts_first_chunk
result_received
audio_played
```

浏览器使用 `performance.now()`，Python 使用 `time.perf_counter()`。Unix 时间只用于跨进程日志关联，不用于直接计算短耗时。

### 3.3 基线命令

终端快速投喂可以排除音频实时播放等待：

```bash
cd apps/local-ai-server
/usr/bin/time -l .venv/bin/python scripts/realtime_client.py \
  --wav tmp/hello.wav \
  --stages asr,mt \
  --fast
```

连续执行 10 次，第一次记为冷启动，其余记录热启动 P50/P95。服务端 CPU 火焰图可使用 `py-spy`，浏览器侧使用 Chrome DevTools Performance 和 Chrome Task Manager。

## 4. P0：最优先优化项

### 4.1 用 VAD 替代固定 7 秒分段

涉及文件：

- `apps/extension/src/entrypoints/offscreen/main.ts`
- `apps/local-ai-server/src/pipeline/vad_segmenter.py`
- `apps/local-ai-server/src/ws/session.py`

当前固定 7 秒才提交识别，是首条译文延迟的主要来源。建议将持续 PCM 流交给服务端 VAD：

1. 20-30ms 音频帧进入 VAD。
2. 检测到 speech-start 后开始语音段。
3. 连续静音 300-600ms 后触发 speech-end。
4. 超过 8-12 秒强制切段，避免超长句。
5. 对不足 300ms 的片段丢弃或与下一段合并。

优先评估 FunASR FSMN-VAD；若模型部署复杂，再评估 Silero VAD。能量阈值只适合调试，不适合作为正式方案。

预期收益：常规句子的提交等待可从固定 7 秒降低到“句尾停顿 + 300-600ms”。

### 4.2 接入流式或增量 ASR

当前 `SenseVoiceSmall` 路径在 `audio.end` 后对整段 WAV 做一次推理。建议分两阶段：

- 短期：VAD 切成 1-4 秒自然语音段，继续使用离线段识别。
- 中期：接入 FunASR streaming Paraformer，输出 `asr.partial` 与 `asr.final`。

partial 只用于字幕预览，final 才进入 MT 和 TTS，避免译文反复跳动和重复合成。

### 4.3 WebSocket 改为二进制音频帧

当前音频使用 Float32 PCM -> Base64 -> JSON：

- Base64 体积约增加 33%。
- 浏览器需要构造大字符串。
- Python 需要 JSON 解析和 Base64 解码。
- 同一音频会出现 TypedArray、字符串、JSON 与 bytes 多份副本。

建议保留 JSON 控制消息，音频改为二进制 WebSocket frame。二进制帧头可以使用固定结构：

```text
magic(4) + version(1) + flags(1) + seq(4) + timestamp(8)
+ sampleRate(4) + channels(1) + format(1) + payloadLength(4) + payload
```

进一步将传输格式从 `f32le` 改为 `pcm16le`，音频负载可再减半。模型推理前再一次性转 Float32，或直接让 ASR 读取 PCM16。

### 4.4 AudioWorklet 使用环形缓冲区

涉及文件：`apps/extension/src/public/voxflow-pcm-capture.worklet.js`

当前 worklet 使用普通 JS 数组和 `splice(0, n)`。这会在实时音频线程中频繁移动数组元素并产生 GC 压力。建议：

- 使用预分配 `Float32Array` 环形缓冲区。
- 使用读写游标，不调用 `push`、`shift`、`splice`。
- 每次只在凑够输出帧时创建可转移的结果 buffer。
- 将 30ms 帧直接 transfer 给 offscreen，避免结构化克隆。

验收方式：连续播放 30 分钟，AudioWorklet 无长任务，页面声音无爆音，扩展进程内存不持续爬升。

### 4.5 增加背压和队列策略

当前服务按连接顺序处理，AI 阶段通过全局锁串行，优点是模型安全，缺点是慢机器上容易积压。建议显式维护：

```text
capture queue -> VAD queue -> ASR worker -> MT worker -> TTS worker -> playback queue
```

每个队列都要有上限和丢弃策略：

- 原始 PCM：只保留最近 10-15 秒。
- 待识别语音段：最多 2 段，超过后优先合并短段或丢弃最旧段。
- MT：只接受 final ASR，避免重复翻译 partial。
- TTS：当播放落后超过阈值时，提高语速、缩短停顿或丢弃过旧句子。

## 5. P1：模型与服务优化

### 5.1 模型预热与健康检查

服务启动后可选择执行 0.5-1 秒静音/测试文本预热，并提供独立状态：

```text
loading -> warming -> ready
```

这样扩展不会把“WebSocket 已连接”误认为“模型已准备好”。建议增加 `/health` 或 WebSocket `engine.capabilities`，返回模型路径、设备、支持语言、是否已预热和当前队列深度。

### 5.2 移除临时 WAV 与 Python 逐样本转换

涉及文件：`apps/local-ai-server/src/providers/asr/funasr_engine.py`

当前每个语音段都执行：

```text
f32 bytes -> Python float 循环 -> PCM16 -> 临时 WAV -> FunASR
```

优化顺序：

1. 确认 FunASR 当前模型是否支持直接传入 NumPy waveform。
2. 使用 `numpy.frombuffer` 和向量化 clip/scale 代替 Python 循环。
3. 若模型必须接收文件，复用内存文件或受控临时目录，并记录文件 I/O 耗时。

### 5.3 翻译模型改用 CTranslate2 INT8

当前 MarianMT 使用 Transformers/PyTorch。CPU 产品化建议转换为 CTranslate2：

- INT8 模型通常占用更少内存。
- CPU 推理延迟和吞吐更稳定。
- 可配置线程数，便于避免与 ASR 抢满全部核心。

转换前后必须对固定测试集比较 BLEU/chrF、P50/P95 延迟和峰值内存，不应只比较平均速度。

### 5.4 清理重复模型格式

当前 `apps/models/mt` 同时包含 PyTorch、TensorFlow、Flax 和 Rust 权重，而运行时只使用 PyTorch。这会显著增加 Git LFS 下载量和磁盘占用。

建议最终只保留一种部署格式，并将大模型从 Git 仓库迁移到：

- GitHub Release 资产；或
- ModelScope/Hugging Face 模型仓库；或
- 首次启动时按 manifest 下载并校验 SHA-256。

推荐仓库只提交模型 manifest、下载脚本和 `.gitkeep`。这项调整会影响 Git 历史与现有用户，应单独执行迁移，不要在普通代码提交里直接删除所有权重。

### 5.5 降低统计事件频率

当前每个 200ms 音频 chunk 都返回一次 `audio.stats`。生产模式可改为每 500-1000ms 聚合一次，debug 模式才逐包返回。这样可减少 WebSocket 消息数、JSON 解析和扩展状态广播。

### 5.6 独立推理进程

当支持多标签页或桌面客户端后，建议将 WebSocket 网关与模型 worker 分进程：

- 网关进程负责连接、校验、背压和协议。
- ASR/MT/TTS worker 各自持有模型。
- 通过有界 IPC 队列传递语音段和结果。

模型崩溃或显存不足时可以单独重启 worker，不中断所有 WebSocket 连接。

## 6. P2：TTS 与播放优化

### 6.1 流式 TTS

优先选择能分片输出的 TTS，避免等待整句音频生成完毕。服务端应尽快发送 `tts.audio seq=0`，后续分片连续追加。

### 6.2 音频编码

- 本机回环网络、低 CPU 优先：PCM16。
- 远程 companion service 或带宽受限：Opus。
- WAV 只适合下载和调试，不适合持续流式传输。

### 6.3 播放同步

以源语音 `startMs/endMs` 为基准维护播放队列：

- 落后较小时增加 TTS 播放速率到 1.05-1.15。
- 落后超过阈值时压缩停顿。
- 严重落后时丢弃已失去上下文价值的旧译文。
- 视频暂停、跳转、倍速变化时清空或重算队列。

不要试图逐字口型同步；第一阶段以“语义连续、延迟有界、不越积越慢”为验收标准。

## 7. 建议实施顺序

### 阶段 A：可观测性

1. 增加统一时间戳和 JSON 结构化日志。
2. 记录冷/热启动、ASR RTF、MT 延迟、RSS 和队列深度。
3. 建立 5s/15s/60s 固定测试集和结果表。

### 阶段 B：降低首条译文延迟

1. 接入 VAD。
2. 将固定 7 秒分段改为自然句段。
3. 增加 partial ASR 字幕。

### 阶段 C：降低 CPU 与内存

1. AudioWorklet 环形缓冲。
2. 二进制 PCM16 WebSocket。
3. NumPy 直接输入 FunASR。
4. `audio.stats` 降频。

### 阶段 D：提高模型吞吐

1. 模型预热。
2. CTranslate2 INT8。
3. 独立模型 worker 和有界队列。

### 阶段 E：接入 TTS 与同步

1. 先接轻量 Piper 验证协议与播放队列。
2. 再评估 CosyVoice 的质量、首包延迟和硬件需求。
3. 实现倍速、丢弃和跳转重置策略。

## 8. 每次优化的验收清单

- 相同机器、相同音频、相同模型版本下比较。
- 同时记录冷启动和至少 10 次热启动。
- 报告 P50/P95，不只报告最快结果。
- 检查识别与翻译质量是否下降。
- 连续运行至少 30 分钟，确认内存不持续增长。
- 模拟本地服务重启、模型报错、视频暂停和页面跳转。
- `npm run compile`、`npm run build` 和 Python 协议测试全部通过。

性能优化的最终目标不是单个模型跑得最快，而是让整个系统在真实视频上保持低延迟、有界内存、可恢复连接和稳定的语义连续性。
