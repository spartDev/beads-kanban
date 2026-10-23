/**
 * Couleurs des tokens de styles.css (oklch) et rapports de contraste WCAG : de quoi vérifier la lisibilité des
 * thèmes sans navigateur. Même méthode que le navigateur : oklch vers sRGB, puis composition des fonds
 * semi-transparents dans l'espace sRGB encodé.
 */

export interface Oklch {
  L: number;
  C: number;
  H: number;
  /** Opacité de 0 à 1 (1 quand la couleur n'en déclare pas). */
  A: number;
}

/** sRGB encodé (gamma), chaque canal de 0 à 1. */
export type Rgb = readonly [number, number, number];

export function parseOklch(value: string): Oklch {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(value.trim());
  if (!match) throw new Error(`Couleur oklch attendue, reçu « ${value} »`);
  const [, L, C, H, A] = match;
  return { L: Number(L), C: Number(C), H: Number(H), A: A === undefined ? 1 : Number(A) };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Couleur opaque en sRGB (matrices d'Oklab ; les teintes sont assez neutres pour rester dans la gamme sRGB). */
export function toSrgb({ L, C, H }: Oklch): Rgb {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    encode(clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    encode(clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    encode(clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}

/** `color` posée sur `under`, avec l'opacité `alpha` (par défaut celle de la couleur). */
export function over(color: Oklch, under: Rgb, alpha: number = color.A): Rgb {
  const [r, g, b] = toSrgb(color);
  return [r * alpha + under[0] * (1 - alpha), g * alpha + under[1] * (1 - alpha), b * alpha + under[2] * (1 - alpha)];
}

/** Luminance relative WCAG. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);
}

/** Rapport de contraste WCAG entre deux couleurs opaques, de 1 à 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
