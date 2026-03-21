"""
agent/config.py
環境変数から読み込むグローバル設定。
"""
import os
from datetime import timezone, timedelta

JST = timezone(timedelta(hours=9))

# 稼働時間帯（Claude API 呼び出しを許可する時間帯、JST）
OPERATING_START_HOUR: int = int(os.getenv("OPERATING_START_HOUR", 8))
OPERATING_END_HOUR: int = int(os.getenv("OPERATING_END_HOUR", 21))
