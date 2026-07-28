# VoxFlow Local Engine Protocol

本文定义 Web 插件、桌面端、CLI 或其他应用与 `voxflow-local-engine` 通信的协议。协议目标是让客户端能够明确指定处理链路，例如仅 ASR、ASR+MT、ASR+MT+TTS，并完整描述传入音频数据与服务端输出。

当前传输层使用 WebSocket JSON 文本帧：

```text
ws://127.0.0.1:8765/ws
```

协议版本：`voxflow.local.v1`

---

## 1. 基础约定

所有消息都是 JSON object，必须包含：

```json
{
  "v": "voxflow.local.v1",
  "type": "message.type",
  "sessionId": "session-uuid-or-client-generated-id"
}
```

推荐字段：

| 字段 | 方向 | 说明 |
|---|---|---|
| `v` | 双向 | 协议版本，当前固定为 `voxflow.local.v1` |
| `type` | 双向 | 消息类型 |
| `sessionId` | 双向 | 会话 ID，由客户端生成 |
| `requestId` | 客户端 -> 服务端 | 请求 ID，用于关联 ack/error |
| `eventId` | 服务端 -> 客户端 | 服务端事件 ID |
| `createdAt` | 双向 | Unix epoch 毫秒，可选 |

错误统一返回：

```json
{
  "v": "voxflow.local.v1",
  "type": "error",
  "sessionId": "s-001",
  "requestId": "req-001",
  "code": "invalid_audio_format",
  "message": "audio.chunk only supports f32le/pcm16 in v1",
  "recoverable": true
}
```

---

## 2. 会话启动

客户端通过 `session.start` 指定本次处理链路和模型。

### 2.1 Pipeline Stages

`pipeline.stages` 决定服务端必须执行哪些模型：

| stages | 含义 | 必须输出 |
|---|---|---|
| `["asr"]` | 仅语音识别 | `asr.final` |
| `["asr", "mt"]` | 识别并翻译文本 | `mt.final` |
| `["asr", "mt", "tts"]` | 识别、翻译、合成语音 | `tts.audio`，最终 `tts.final` |

客户端可通过 `pipeline.emitIntermediates` 控制是否返回中间产物。比如 `asr+mt+tts` 时，若为 `true`，服务端仍可返回 `asr.final`、`mt.final` 供字幕显示。

### 2.2 session.start 示例

```json
{
  "v": "voxflow.local.v1",
  "type": "session.start",
  "sessionId": "s-001",
  "requestId": "req-start-001",
  "pipeline": {
    "stages": ["asr", "mt"],
    "emitIntermediates": true,
    "latencyMode": "balanced"
  },
  "models": {
    "asr": {
      "provider": "funasr",
      "model": "/Users/xh/work/AiProject/voxflow/models/asr/SenseVoiceSmall",
      "language": "en",
      "device": "cpu",
      "mode": "segment"
    },
    "mt": {
      "provider": "argos",
      "sourceLang": "en",
      "targetLang": "zh"
    }
  },
  "input": {
    "audio": {
      "streamId": "tab-audio-main",
      "sampleRate": 16000,
      "channels": 1,
      "sampleFormat": "f32le",
      "codec": "pcm",
      "frameDurationMs": 200
    }
  }
}
```

服务端成功后返回：

```json
{
  "v": "voxflow.local.v1",
  "type": "session.started",
  "sessionId": "s-001",
  "requestId": "req-start-001",
  "acceptedStages": ["asr", "mt"],
  "message": "session ready"
}
```

---

## 3. 模型配置

### 3.1 ASR

```json
{
  "provider": "funasr",
  "model": "iic/SenseVoiceSmall 或本地绝对路径",
  "language": "en",
  "device": "cpu",
  "mode": "streaming | segment | offline",
  "vad": {
    "enabled": true,
    "provider": "funasr-fsmn-vad",
    "minSpeechMs": 300,
    "maxSegmentMs": 8000
  },
  "punctuation": {
    "enabled": true
  }
}
```

### 3.2 MT

```json
{
  "provider": "argos | libretranslate | ctranslate2",
  "model": "可选，本地模型路径或模型名",
  "sourceLang": "en",
  "targetLang": "zh"
}
```

### 3.3 TTS

```json
{
  "provider": "piper | cosyvoice",
  "model": "可选，本地模型路径或模型名",
  "voice": "zh_CN-default",
  "language": "zh",
  "outputAudio": {
    "codec": "pcm | wav | opus",
    "sampleFormat": "pcm16le",
    "sampleRate": 24000,
    "channels": 1
  }
}
```

---

## 4. 音频输入协议

音频数据使用 `audio.chunk` 发送。v1 默认使用 JSON + base64，便于 Web 插件、桌面端和脚本统一实现。

```json
{
  "v": "voxflow.local.v1",
  "type": "audio.chunk",
  "sessionId": "s-001",
  "requestId": "req-audio-0001",
  "streamId": "tab-audio-main",
  "seq": 1,
  "time": {
    "startMs": 0,
    "durationMs": 200,
    "mediaTimeSec": 12.4,
    "captureUnixMs": 1783150000000
  },
  "audio": {
    "transport": "json.base64",
    "codec": "pcm",
    "sampleFormat": "f32le",
    "endianness": "little",
    "sampleRate": 16000,
    "channels": 1,
    "channelLayout": "mono",
    "frameCount": 3200,
    "byteLength": 12800,
    "data": "BASE64_ENCODED_AUDIO"
  }
}
```

### 4.1 audio 字段说明

| 字段 | 必填 | 说明 |
|---|---:|---|
| `transport` | 是 | 当前为 `json.base64`，未来可扩展 `binary` |
| `codec` | 是 | `pcm`、`wav`、`opus`，MVP 推荐 `pcm` |
| `sampleFormat` | 是 | `f32le`、`pcm16le` |
| `endianness` | PCM 时必填 | `little` |
| `sampleRate` | 是 | 推荐输入 `16000` |
| `channels` | 是 | 推荐 `1` |
| `channelLayout` | 否 | `mono`、`stereo` |
| `frameCount` | 是 | 采样点数量，单声道时等于 samples 数量 |
| `byteLength` | 是 | base64 解码后的字节数 |
| `data` | 是 | base64 音频内容 |
| `checksum` | 否 | 可选，如 `{ "algorithm": "sha256", "value": "..." }` |

推荐 chunk 时长：

```text
实时模式：100ms - 300ms
当前 MVP：200ms
离线/文件模式：可更大，但建议不超过 2s
```

客户端发送完当前片段后使用：

```json
{
  "v": "voxflow.local.v1",
  "type": "audio.end",
  "sessionId": "s-001",
  "requestId": "req-audio-end-001",
  "streamId": "tab-audio-main",
  "lastSeq": 35,
  "reason": "segment_complete"
}
```

兼容当前 MVP 时，`session.stop` 可等价于 `audio.end + session.close`。

---

## 5. 服务端输出协议

服务端输出由 `pipeline.stages` 决定。

### 5.1 仅 ASR

客户端：

```json
{
  "v": "voxflow.local.v1",
  "type": "session.start",
  "sessionId": "asr-only-001",
  "pipeline": {
    "stages": ["asr"],
    "emitIntermediates": true
  },
  "models": {
    "asr": {
      "provider": "funasr",
      "model": "/models/asr/SenseVoiceSmall",
      "language": "en"
    }
  }
}
```

服务端输出：

```json
{
  "v": "voxflow.local.v1",
  "type": "asr.final",
  "sessionId": "asr-only-001",
  "segmentId": "seg-0001",
  "text": "The tribal chieftain called for the boy.",
  "language": "en",
  "startMs": 0,
  "endMs": 7176,
  "confidence": 0.92
}
```

最终汇总：

```json
{
  "v": "voxflow.local.v1",
  "type": "result.final",
  "sessionId": "asr-only-001",
  "kind": "asr",
  "segmentId": "seg-0001",
  "text": "The tribal chieftain called for the boy.",
  "startMs": 0,
  "endMs": 7176
}
```

### 5.2 ASR + MT

服务端可以返回 ASR 中间产物，但必须返回 `mt.final`：

```json
{
  "v": "voxflow.local.v1",
  "type": "mt.final",
  "sessionId": "asr-mt-001",
  "segmentId": "seg-0001",
  "source": {
    "text": "The tribal chieftain called for the boy and presented him with 50 pieces of gold.",
    "language": "en"
  },
  "target": {
    "text": "部落酋长叫来了那个男孩，并送给他50枚金币。",
    "language": "zh"
  },
  "startMs": 0,
  "endMs": 7176
}
```

最终汇总：

```json
{
  "v": "voxflow.local.v1",
  "type": "result.final",
  "sessionId": "asr-mt-001",
  "kind": "text",
  "segmentId": "seg-0001",
  "sourceText": "The tribal chieftain called for the boy and presented him with 50 pieces of gold.",
  "translatedText": "部落酋长叫来了那个男孩，并送给他50枚金币。",
  "sourceLang": "en",
  "targetLang": "zh",
  "startMs": 0,
  "endMs": 7176
}
```

### 5.3 ASR + MT + TTS

服务端必须返回翻译音频。TTS 音频可分片返回：

```json
{
  "v": "voxflow.local.v1",
  "type": "tts.audio",
  "sessionId": "asr-mt-tts-001",
  "segmentId": "seg-0001",
  "seq": 1,
  "text": "部落酋长叫来了那个男孩，并送给他50枚金币。",
  "audio": {
    "transport": "json.base64",
    "codec": "pcm",
    "sampleFormat": "pcm16le",
    "sampleRate": 24000,
    "channels": 1,
    "durationMs": 3100,
    "byteLength": 148800,
    "data": "BASE64_ENCODED_TTS_AUDIO"
  },
  "sourceStartMs": 0,
  "sourceEndMs": 7176
}
```

TTS 完成：

```json
{
  "v": "voxflow.local.v1",
  "type": "tts.final",
  "sessionId": "asr-mt-tts-001",
  "segmentId": "seg-0001",
  "chunks": 1,
  "durationMs": 3100
}
```

最终汇总：

```json
{
  "v": "voxflow.local.v1",
  "type": "result.final",
  "sessionId": "asr-mt-tts-001",
  "kind": "audio",
  "segmentId": "seg-0001",
  "sourceText": "The tribal chieftain called for the boy and presented him with 50 pieces of gold.",
  "translatedText": "部落酋长叫来了那个男孩，并送给他50枚金币。",
  "audioFormat": {
    "codec": "pcm",
    "sampleFormat": "pcm16le",
    "sampleRate": 24000,
    "channels": 1
  },
  "audioChunks": 1,
  "startMs": 0,
  "endMs": 7176
}
```

---

## 6. 状态与控制消息

### 6.1 engine.status

```json
{
  "v": "voxflow.local.v1",
  "type": "engine.status",
  "sessionId": "s-001",
  "state": "loading | ready | running | draining | stopped | error",
  "stage": "asr | mt | tts",
  "message": "FunASR model loaded"
}
```

### 6.2 media.state

用于同步视频播放状态：

```json
{
  "v": "voxflow.local.v1",
  "type": "media.state",
  "sessionId": "s-001",
  "currentTimeSec": 123.45,
  "paused": false,
  "playbackRate": 1.0
}
```

### 6.3 session.cancel / session.close

```json
{
  "v": "voxflow.local.v1",
  "type": "session.cancel",
  "sessionId": "s-001",
  "reason": "user_stop"
}
```

```json
{
  "v": "voxflow.local.v1",
  "type": "session.close",
  "sessionId": "s-001",
  "reason": "page_closed"
}
```

---

## 7. 推荐处理规则

1. 客户端必须先发 `session.start`，再发 `audio.chunk`。
2. 同一 `sessionId + streamId` 下 `seq` 必须递增。
3. 服务端必须按 `pipeline.stages` 决定最终输出类型。
4. `emitIntermediates=false` 时，服务端可以省略中间 ASR/MT 事件，但不得省略目标阶段结果。
5. 若 stages 为 `["asr"]`，不得强制加载 MT/TTS 模型。
6. 若 stages 为 `["asr", "mt"]`，不得强制加载 TTS 模型。
7. 若 stages 为 `["asr", "mt", "tts"]`，可返回 ASR/MT 中间结果，但最终必须返回 TTS 音频。
8. 服务端应缓存模型实例，但会话状态必须按 `session.start` 重置。
9. 音频大包应拆成小 chunk，推荐 200ms，避免 WebSocket 大帧阻塞。
10. 客户端应能容忍重复 `engine.status` 和 partial 事件。

---

## 8. 当前实现状态

当前扩展、CLI 与本地服务均已使用 `voxflow.local.v1`：

| 能力 | 当前状态 |
|---|---|
| `session.start.pipeline.stages` | 已实现 `asr`、`asr+mt` |
| `audio.chunk.audio.data` | 已实现 `json.base64`，支持 mono `f32le` / `pcm16le` |
| `audio.end` | 已实现，并触发当前音频段 finalize |
| `asr.final` / `mt.final` | 已实现 |
| `result.final` | 已实现 `kind=asr` 与 `kind=text` |
| `tts.audio` | 协议已定义，推理引擎尚未接入；请求时返回 `tts_unavailable` |

服务端会校验 `sessionId`、`streamId`、`seq`、Base64、字节数、帧数、采样率与声道数。旧版 `translation.final` 兼容事件已移除，客户端应消费 `mt.final` 或 `result.final`。
