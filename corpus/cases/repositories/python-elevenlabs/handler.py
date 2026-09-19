from elevenlabs import generate
from store import db

def handler(event):
    audio = generate(text=event.get("text"), voice=event.get("voice"))
    db.save({"audio": audio, "voice": event.get("voice")})
    return {"ok": True}
