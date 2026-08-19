import { assertEquals, assertNotEquals } from './assertions.ts';

import { b64u, b64uBytes, decodeBase64, derToRawEcdsa, toBase64Url } from './encoding.ts';

/**
 * DER-encode a signature the way a real ECDSA implementation would, so the
 * parser is tested against the format it will actually meet rather than against
 * whatever the parser happens to accept.
 */
function derEncode(r: Uint8Array, s: Uint8Array): Uint8Array {
  const int = (v: Uint8Array): number[] => {
    // Strip leading zeros, then re-add one if the top bit is set: DER integers
    // are signed, and this is the byte that breaks naive parsers.
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    const body = Array.from(v.slice(i));
    if ((body[0] ?? 0) & 0x80) body.unshift(0);
    return [0x02, body.length, ...body];
  };

  // Short form only: a P-256 signature's contents never reach 128 bytes, so
  // this is what a real one looks like. The long-form case is built by hand in
  // its own test.
  const contents = [...int(r), ...int(s)];
  return new Uint8Array([0x30, contents.length, ...contents]);
}

function scalar(fill: (i: number) => number): Uint8Array {
  return new Uint8Array(Array.from({ length: 32 }, (_, i) => fill(i)));
}

Deno.test('derToRawEcdsa round-trips an ordinary signature', () => {
  const r = scalar((i) => i + 1);
  const s = scalar((i) => 64 - i);

  const raw = derToRawEcdsa(derEncode(r, s));
  assertEquals(raw?.slice(0, 32), r);
  assertEquals(raw?.slice(32), s);
});

Deno.test('it strips the sign byte DER adds when the top bit is set', () => {
  // 0xFF… has its top bit set, so DER prefixes 0x00 and the integer is 33 bytes.
  // Treating that byte as part of the number shifts everything by one and the
  // signature fails to verify — for roughly half of all real signatures.
  const r = scalar((i) => (i === 0 ? 0xff : i));
  const s = scalar((i) => (i === 0 ? 0x80 : 2));

  const der = derEncode(r, s);
  assertEquals(der.length > 70, true, 'the fixture really did grow a sign byte');

  const raw = derToRawEcdsa(der);
  assertEquals(raw?.length, 64);
  assertEquals(raw?.slice(0, 32), r);
  assertEquals(raw?.slice(32), s);
});

Deno.test('it left-pads a scalar whose leading zeros DER dropped', () => {
  // A small r encodes short. Written flush left it would be the wrong number
  // entirely; it has to land at the right-hand end of its 32 bytes.
  const r = scalar((i) => (i < 29 ? 0 : i));
  const s = scalar((i) => i + 1);

  const raw = derToRawEcdsa(derEncode(r, s));
  assertEquals(raw?.slice(0, 32), r);
  assertEquals(raw?.slice(32), s);
});

Deno.test('it handles a long-form length header', () => {
  // A real P-256 signature never needs one — its contents top out around 70
  // bytes, well under the 128 that forces long form. So this is constructed by
  // hand: the parser accepts it, and a parser that assumed short form would read
  // the length byte as the first integer's tag and return null.
  const r = scalar((i) => 0x10 + (i % 8));
  const s = scalar((i) => 0x20 + (i % 8));
  const shortForm = derEncode(r, s);
  const contents = shortForm.slice(2);
  const longForm = new Uint8Array([0x30, 0x81, contents.length, ...contents]);

  assertEquals(longForm[1], 0x81, 'the fixture really is long-form');
  const raw = derToRawEcdsa(longForm);
  assertEquals(raw?.slice(0, 32), r);
  assertEquals(raw?.slice(32), s);
});

Deno.test('two different signatures do not decode to the same bytes', () => {
  const a = derToRawEcdsa(derEncode(scalar((i) => i + 1), scalar(() => 7)));
  const b = derToRawEcdsa(derEncode(scalar((i) => i + 2), scalar(() => 7)));
  assertNotEquals(a, b);
});

Deno.test('malformed input returns null rather than throwing', () => {
  // This parses bytes from a public endpoint. The caller's job is to refuse.
  const cases: Array<[string, Uint8Array]> = [
    ['empty', new Uint8Array()],
    ['too short', new Uint8Array([0x30, 0x02, 0x02, 0x01, 0x01])],
    ['not a sequence', new Uint8Array(72).fill(0x31)],
    ['second element is not an integer', new Uint8Array([
      0x30, 0x08, 0x02, 0x02, 0x01, 0x02, 0x03, 0x02, 0x01, 0x02,
    ])],
    ['length runs past the buffer', new Uint8Array([
      0x30, 0x46, 0x02, 0x40, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
    ])],
  ];

  for (const [name, input] of cases) {
    assertEquals(derToRawEcdsa(input), null, name);
  }
});

Deno.test('a scalar longer than 32 significant bytes is refused', () => {
  const tooBig = new Uint8Array(33).fill(0x7f);
  const der = new Uint8Array([
    0x30, 0x46,
    0x02, 33, ...tooBig,
    0x02, 0x01, 0x01,
  ]);
  assertEquals(derToRawEcdsa(der), null);
});

Deno.test('base64url encoding has no padding and no + or /', () => {
  // Play Integrity echoes the nonce base64url-encoded. A mismatch here reads as
  // a replay attempt and silently costs an honest user their coins.
  const encoded = b64uBytes(new Uint8Array([251, 255, 190, 0, 1, 2]));
  assertEquals(encoded.includes('+'), false);
  assertEquals(encoded.includes('/'), false);
  assertEquals(encoded.includes('='), false);
});

Deno.test('toBase64Url converts standard base64 to the same alphabet', () => {
  const raw = new Uint8Array([251, 255, 190, 0]);
  let bin = '';
  for (const b of raw) bin += String.fromCharCode(b);
  assertEquals(toBase64Url(btoa(bin)), b64uBytes(raw));
});

Deno.test('b64u round-trips text through decodeBase64', () => {
  const text = 'nonce with + and / and = in it';
  const encoded = b64u(text);
  const standard = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  assertEquals(new TextDecoder().decode(decodeBase64(padded)), text);
});
