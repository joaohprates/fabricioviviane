import json
import re
import sys
from pathlib import Path

from docx import Document


PHONE_RE = re.compile(r"\+55\s*\d{2}\s*\d{4,5}-\d{4}")
PAREN_RE = re.compile(r"\s*\([^)]*\)")


def normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def main() -> None:
    source = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    document = Document(source)
    guests = []

    for paragraph in document.paragraphs:
        raw = normalize_spaces(paragraph.text)
        if not raw:
            continue
        if raw in {"Fabrício e Viviane", "Lista de convidados", "(NOIVO):", "(NOIVA):"}:
            continue
        if raw.startswith("*OBS."):
            continue

        phone_match = PHONE_RE.search(raw)
        phone = normalize_spaces(phone_match.group(0)) if phone_match else ""
        family = raw[: phone_match.start()] if phone_match else raw
        family = PAREN_RE.sub("", family).replace("*", "")
        family = re.sub(r"\s*\+\s*(\d+)", r" +\1", family)
        family = normalize_spaces(family).strip(" ,")
        if not family:
            continue

        token_match = re.match(r"[^\W\d_]+", family, flags=re.UNICODE)
        token = token_match.group(0) if token_match else family.split()[0]
        guests.append({"token": token, "familia": family, "numero": phone})

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(guests, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"rows": len(guests), "missing_phone": sum(not g["numero"] for g in guests)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
