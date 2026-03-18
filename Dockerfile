FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agent/ ./agent/
COPY prompts/ ./prompts/

CMD ["python", "-m", "agent.main"]
