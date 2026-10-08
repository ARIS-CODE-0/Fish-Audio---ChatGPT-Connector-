const encoder = new TextEncoder();
const base64 = (data: Uint8Array) => btoa(String.fromCharCode(...data));
const bytes = (data: string) => Uint8Array.from(atob(data), c => c.charCodeAt(0));
async function rootKey(secret: string) {
  const material = bytes(secret);
  if (material.length !== 32) throw new Error("Encryption secret must contain 32 bytes.");
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptKey(value: string, userId: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv,
    additionalData: encoder.encode(userId) }, await rootKey(secret), encoder.encode(value));
  return `v1.${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}
export async function decryptKey(value: string, userId: string, secret: string) {
  const [version, iv, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !ciphertext) throw new Error("Invalid encrypted credential.");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(iv),
    additionalData: encoder.encode(userId) }, await rootKey(secret), bytes(ciphertext));
  return new TextDecoder().decode(plain);
}
