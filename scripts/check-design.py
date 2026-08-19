#!/usr/bin/env python3
"""
Two of README §9's rules, enforced rather than remembered.

§9.2  Brass is reserved for coin values. "The moment it appears on a button that
      isn't about coins, the coin stops feeling like currency." So the hex may
      appear in the token definition, and the token may be used in exactly one
      component file. Anywhere else fails.

§9.6  "Never use the words points, rewards, cashback, or earn money. We say
      coins, mint, discount." Checked against the user-facing strings only —
      `rewarded video` is our internal name for an ad unit and appears in code
      and in the schema, but it must never reach a screen.

Run: python3 scripts/check-design.py
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / 'mobile'

BRASS_HEX = '#C8952E'
BRASS_TOKEN = 'COIN_BRASS'

# The only two files allowed to know about brass.
BRASS_DEFINITION = APP / 'src' / 'theme' / 'tokens.ts'
BRASS_CONSUMER = APP / 'src' / 'components' / 'Coin.tsx'
# The Android notification channel accent. The notifications it colours are about
# coins expiring, which is what brass is for — so it is an exception with a
# reason, given its own named file so it stays visible instead of buried in a
# settings object.
BRASS_NOTIFICATION_CHANNEL = APP / 'src' / 'lib' / 'notification-colour.ts'

FORBIDDEN_WORDS = [
    (r'\bpoints?\b', 'points'),
    (r'\brewards?\b', 'rewards'),
    (r'\bcash\s?back\b', 'cashback'),
    (r'\bearn\s+money\b', 'earn money'),
]

failures: list[str] = []


def sources() -> list[pathlib.Path]:
    if not APP.exists():
        return []
    return [
        p
        for p in APP.rglob('*.ts*')
        if 'node_modules' not in p.parts and '.expo' not in p.parts
    ]


def check_brass() -> None:
    allowed = {
        BRASS_DEFINITION.resolve(),
        BRASS_CONSUMER.resolve(),
        BRASS_NOTIFICATION_CHANNEL.resolve(),
    }
    for path in sources():
        if path.resolve() in allowed:
            continue
        for n, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            if BRASS_HEX in line or re.search(rf'\b{BRASS_TOKEN}\b', line):
                rel = path.relative_to(ROOT)
                failures.append(
                    f'{rel}:{n}: brass is reserved for coin values (README §9.2). '
                    f'Use <CoinValue> from src/components/Coin.tsx.'
                )


def string_literals(text: str) -> list[tuple[int, str]]:
    """Every single- or double-quoted literal, with its line number."""
    out: list[tuple[int, str]] = []
    for n, line in enumerate(text.splitlines(), 1):
        for match in re.finditer(r"'([^'\\]*(?:\\.[^'\\]*)*)'|\"([^\"\\]*(?:\\.[^\"\\]*)*)\"", line):
            out.append((n, match.group(1) or match.group(2) or ''))
    return out


def check_copy() -> None:
    i18n = APP / 'src' / 'i18n'
    if not i18n.exists():
        return
    for path in i18n.glob('*.ts'):
        text = path.read_text(encoding='utf-8')
        # Strip comments: the rules themselves quote the forbidden words.
        text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
        text = re.sub(r'^\s*//.*$', '', text, flags=re.M)
        for n, literal in string_literals(text):
            for pattern, word in FORBIDDEN_WORDS:
                if re.search(pattern, literal, re.I):
                    rel = path.relative_to(ROOT)
                    failures.append(
                        f'{rel}:{n}: user-facing copy says "{word}" (README §9.6). '
                        f'Say coins, mint, or discount.'
                    )


def check_no_gps() -> None:
    """§2 — no GPS anywhere. A transitive dependency cannot add one back silently."""
    banned = re.compile(r'expo-location|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|getCurrentPosition')
    for path in sources():
        text = path.read_text(encoding='utf-8')
        for n, line in enumerate(text.splitlines(), 1):
            if banned.search(line):
                rel = path.relative_to(ROOT)
                failures.append(f'{rel}:{n}: location APIs are not used in this app (README §2).')


def main() -> int:
    if not APP.exists():
        print('mobile/ not present — nothing to check')
        return 0

    check_brass()
    check_copy()
    check_no_gps()

    if failures:
        print(f'{len(failures)} design rule violation(s):\n')
        for f in failures:
            print(f'  {f}')
        return 1

    print('design rules hold: brass is coin-only, no forbidden words, no location APIs')
    return 0


if __name__ == '__main__':
    sys.exit(main())
