declare module "qrcode-terminal" {
  export function generate(input: string, options?: { small?: boolean }): void;
  const qrcode: { generate: typeof generate };
  export default qrcode;
}
