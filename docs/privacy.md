# Privacy and Local Security

VoxFlow 默认在本机捕获、识别和翻译音频。模型准备完成后，运行链路不需要把原始音频、识别文本或译文发送到云端。

当前保护：

- 本地服务默认只绑定 `127.0.0.1`，启动入口拒绝非 loopback host。
- ASR 临时 WAV 在推理结束后的 `finally` 中删除。
- 浏览器请求默认限制为扩展 Origin。
- 可选共享 Token 同时保护 `/health` 与 `/ws`。
- WebSocket 帧、session、stream、序号、音频长度和格式均有边界校验。

当前限制：

- Token 默认不启用，也不会自动生成或分发。
- 默认 Origin 规则允许任意浏览器扩展 scheme，建议配置精确扩展 ID。
- 没有 TLS、速率限制或进程级沙箱，服务不可暴露到公网。
- 模型下载脚本会访问 ModelScope 或 Hugging Face；这是安装阶段的网络行为，不是播放时的数据上传。

不要把本地服务绑定到 `0.0.0.0`，除非另行部署了认证、TLS、防火墙和访问审计。
