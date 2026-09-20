from contoso_ai import generate
from store import db

def handler(_event):
    generation = generate(prompt="controlled")
    db.save({"score": generation["legacy_score"]})
    return {"ok": True}
