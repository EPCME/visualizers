// Pack mapping text into a short, URL-safe string (deflate + base64url) and back.

const toB64Url = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function packText(text) {
  return toB64Url(await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw')));
}

export async function unpackText(packed) {
  try {
    return new TextDecoder().decode(await pipe(fromB64Url(packed), new DecompressionStream('deflate-raw')));
  } catch {
    throw new Error('The mapping in this link is damaged or incomplete. Was the link cut off when it was copied?');
  }
}
