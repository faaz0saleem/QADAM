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
    """
    Brass may appear in three files, and the third may only be IMPORTED by one.

    The notification-channel exception was added for a real reason, and it then
    became a way to obtain brass anywhere by importing it — which is how a rule
    with one exception becomes a rule with none. Importing it outside the
    notifications path is now a violation in its own right.
    """
    allowed = {
        BRASS_DEFINITION.resolve(),
        BRASS_CONSUMER.resolve(),
        BRASS_NOTIFICATION_CHANNEL.resolve(),
    }
    may_import_channel_colour = {(APP / 'src' / 'lib' / 'notifications.ts').resolve()}

    for path in sources():
        if path.resolve() in allowed or path.resolve() in may_import_channel_colour:
            continue
        for n, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            if 'notification-colour' in line or 'COIN_BRASS_FOR_NOTIFICATION_CHANNEL' in line:
                failures.append(
                    f'{path.relative_to(ROOT)}:{n}: the notification-channel brass '
                    f'exception is not a way to reach brass elsewhere (README §9.2).'
                )
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


def opening_tag(text: str, start: int) -> str | None:
    """
    The props of a JSX element starting at `start`, up to the `>` that actually
    closes the opening tag.

    Naively scanning for the next `>` finds the one in `onPress={() => ...}`
    instead, which reports every arrow-function handler as unlabelled. Track
    brace depth and quotes and the arrow stops mattering.
    """
    depth = 0
    quote: str | None = None
    i = start
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in '"\'`':
            quote = ch
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        elif ch == '>' and depth == 0:
            return text[start:i]
        i += 1
    return None


def check_pressables_are_labelled() -> None:
    """
    §9.7, unannounced quality floor: "screen-reader labels on every interactive
    element". A Pressable with only a bare string inside announces as "button"
    and nothing else, which on a screen where every row is a button is the same
    as announcing nothing.

    Checked structurally because it is exactly the kind of thing that is correct
    on the day it is written and wrong three screens later.
    """
    opener = re.compile(r'<Pressable\b')
    for path in sources():
        text = path.read_text(encoding='utf-8')
        for match in opener.finditer(text):
            props = opening_tag(text, match.start())
            if props is None:
                continue
            if 'accessibilityRole' in props or 'accessibilityLabel' in props:
                continue
            # A wrapper may spread them in.
            if re.search(r'\{\.\.\.\w+\}', props):
                continue
            line = text[: match.start()].count('\n') + 1
            rel = path.relative_to(ROOT)
            failures.append(
                f'{rel}:{line}: <Pressable> without accessibilityRole or '
                f'accessibilityLabel (README §9.7).'
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
    check_pressables_are_labelled()
    check_no_gps()

    if failures:
        print(f'{len(failures)} design rule violation(s):\n')
        for f in failures:
            print(f'  {f}')
        return 1

    print('design rules hold: brass is coin-only, copy is clean, every '
          'Pressable is labelled, no location APIs')
    return 0


if __name__ == '__main__':
    sys.exit(main())
