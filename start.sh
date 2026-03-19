#!/bin/bash
# ambient-agent 起動スクリプト
# 既に動いていれば起動しない

PIDFILE="/tmp/ambient-agent.pid"
LOG="/home/ctoshiki/projects/ambient-agent/data/agent.log"

if [ -f "$PIDFILE" ] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then
    echo "ambient-agent is already running (PID $(cat $PIDFILE))"
    exit 0
fi

cd /home/ctoshiki/projects/ambient-agent
nohup .venv/bin/python -m agent.main >> "$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "ambient-agent started (PID $!)"
