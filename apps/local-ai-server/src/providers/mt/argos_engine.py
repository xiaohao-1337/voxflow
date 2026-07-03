"""Small local translation adapter placeholder.

The real Argos/CTranslate2 integration will replace this. For the first
FunASR integration test, we need the service to produce Chinese output even
when a translation model is not installed.
"""

from __future__ import annotations


PHRASES = {
    "hello": "你好",
    "hello world": "你好，世界",
    "hello world this is a voice translation test": "你好，世界。这是一个语音翻译测试。",
    "this is a test": "这是一个测试",
    "this is a voice translation test": "这是一个语音翻译测试",
    "the tribal chieftain called for the boy and presented him with 50 pieces of gold": (
        "部落酋长叫来了那个男孩，并送给他50枚金币。"
    ),
    "smoke test audio received": "已收到本地服务测试音频",
}


def translate_to_zh(text: str) -> str:
    normalized = " ".join(text.lower().replace(".", " ").replace(",", " ").split())
    if normalized in PHRASES:
        return PHRASES[normalized]
    for phrase, translated in PHRASES.items():
        if phrase in normalized:
            return translated
    return f"【待接入本地翻译】{text}"
